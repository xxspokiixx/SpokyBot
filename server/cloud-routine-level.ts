// On a Cloud home a routine runs at the level of the conversation it was made in. A routine a bot made where only the
// owner spoke is the owner's, so its runs keep the bot's own level. Lending and memory also need that conversation to
// hold no report of anyone else's routine (the routine fingerprint).
import type { RoutineRequestCardData } from "../shared/routine-request.ts";
import { ownerOnlyConversation } from "./cloud-lending.ts";
import type { asSchedule } from "./routine-requests.ts";

type Card = Parameters<typeof ownerOnlyConversation>[0][number]["card"] & { routineRequest?: RoutineRequestCardData };
type Line = Omit<Parameters<typeof ownerOnlyConversation>[0][number], "card"> & { card?: Card; webhookPost?: unknown };

/** Who spoke: whoever opened it, every person's line and every card a person answered is the owner's, and nothing came
 * in by webhook. What bots posted there (receipts, routine reports) does not count. */
export function ownerSpokeOnly(thread: readonly Line[], starters: readonly (string | undefined)[], ownerPerson: (person: string | undefined) => boolean,
  cardAnswerer: (card: NonNullable<Card>) => string | undefined): boolean {
  return starters.every((person) => person === undefined || ownerPerson(person)) &&
    ownerOnlyConversation(thread, ownerPerson, cardAnswerer) && !thread.some((line) => line.webhookPost);
}

export interface OwnersRoutinesInput {
  routines: readonly { id: string; sourceThreadId?: string }[];
  nobodyKey: string;
  writer(id: string): string | undefined;
  recorded(id: string): boolean;
  thread(threadId: string): readonly Line[];
  starters(threadId: string): readonly (string | undefined)[];
  /** A key proven the owner's, as lending and memory require. */
  ownerPerson(person: string | undefined): boolean;
  reportFromOthers(line: Line): boolean;
  cardAnswerer(card: NonNullable<Card>): string | undefined;
  /** What the routine runs now, and what its creating card showed, in one comparable form. */
  shape(id: string): string | undefined;
  cardShape(line: Line): string | undefined;
}

/** Nobody's routines that a bot made in a conversation only the owner spoke in, and that still run exactly what that card showed;
 * `proven` when that conversation held no report of anyone else's routine before the card either. */
export function ownersRoutinesMadeInChat(input: OwnersRoutinesInput): Array<{ id: string; proven: boolean }> {
  return input.routines.flatMap((routine) => {
    if (input.writer(routine.id) !== input.nobodyKey || input.recorded(routine.id) || !routine.sourceThreadId) return [];
    const thread = input.thread(routine.sourceThreadId);
    const made = thread.findIndex((line) => line.card?.routineRequest?.resultId === routine.id && line.card.routineRequest.operation.action === "create");
    if (made < 0 || thread[made]!.card?.answered !== "allow") return [];
    const shape = input.shape(routine.id), upTo = thread.slice(0, made + 1);
    if (shape === undefined || shape !== input.cardShape(thread[made]!) ||
      !ownerSpokeOnly(upTo, input.starters(routine.sourceThreadId), input.ownerPerson, input.cardAnswerer)) return [];
    return [{ id: routine.id, proven: !upTo.some(input.reportFromOthers) }];
  });
}

/** What a routine runs, for comparing against what a person or a card saw; never the moving schedule anchor. */
export function approvalShape(shape: { prompt?: string; botId?: string; runOn?: string; schedule?: unknown; target?: string; groupId?: string | null; attachments?: { id: string; path: string }[] }): string {
  const schedule = shape.schedule && typeof shape.schedule === "object" ? { ...(shape.schedule as Record<string, unknown>) } : null;
  if (schedule) delete schedule.anchorAt;
  return JSON.stringify([shape.prompt ?? "", shape.botId ?? "", shape.runOn ?? "maus", schedule, shape.target ?? "bot", shape.groupId ?? null,
    (shape.attachments ?? []).map((attachment) => [attachment.id, attachment.path])]);
}

/** What a bot's create card showed, in approvalShape's form, its schedule read as the card's own `asSchedule` read it. */
export function createdShape(line: { card?: { routineRequest?: RoutineRequestCardData } }, schedule: typeof asSchedule): string | undefined {
  const request = line.card?.routineRequest;
  if (request?.operation.action !== "create") return undefined;
  const definition = request.operation.routine;
  return approvalShape({ prompt: definition.instructions, botId: request.operation.forBot?.botId ?? request.botId, runOn: definition.runOn, schedule: schedule(definition.schedule, 0) });
}
