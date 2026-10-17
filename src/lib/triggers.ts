// One trigger as the chat card shows it: a schedule (routine) or a webhook, read live from the store, so the card and
// the Triggers page never disagree and the card updates as runs come in.
import type { Routine, RoutineRun } from "@/lib/routines";
import { niceDate, niceTime, scheduleLabel } from "@/lib/schedule-label";
import type { WebhookTrigger } from "@/lib/webhooks";
import type { OptionCardData } from "@/state/store";

export type TriggerKind = "schedule" | "webhook";

/** The trigger a card made: a create that applied on its own, not undone. Its id never changes, so the card follows it. */
export function cardTrigger(card: OptionCardData): { kind: TriggerKind; id: string } | null {
  if (!card.autoApplied || card.answered !== "allow" || card.held) return null;
  const routine = card.routineRequest;
  if (routine?.operation.action === "create" && routine.resultId) return { kind: "schedule", id: routine.resultId };
  const webhook = card.webhookRequest;
  if (webhook?.operation.action === "create" && webhook.resultId) return { kind: "webhook", id: webhook.resultId };
  return null;
}

export interface TriggerView {
  kind: TriggerKind;
  id: string;
  name: string;
  botId: string;
  instructions: string;
  enabled: boolean;
  when: string;
  /** What happens next when nothing has fired yet: the next run, or what it waits for. */
  next?: string;
  lastFire?: RoutineRun;
  firesToday: number;
}

function startOfToday(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

const fireTime = (run: RoutineRun) => run.startedAt ?? run.scheduledFor ?? run.createdAt;

export function triggerView(
  ref: { kind: TriggerKind; id: string },
  sources: { routines: readonly Routine[]; webhooks: readonly WebhookTrigger[]; runs: readonly RoutineRun[] },
  now = Date.now(),
): TriggerView | null {
  const fires = sources.runs.filter((run) => run.routineId === ref.id && run.status !== "missed")
    .sort((left, right) => fireTime(right) - fireTime(left));
  const today = startOfToday(now);
  const firesToday = fires.filter((run) => fireTime(run) >= today).length;
  if (ref.kind === "schedule") {
    const routine = sources.routines.find((candidate) => candidate.id === ref.id);
    if (!routine) return null;
    const next = routine.enabled && routine.nextRunAt != null ? `Next ${niceDate(routine.nextRunAt)}, ${niceTime(routine.nextRunAt)}` : undefined;
    return { kind: "schedule", id: routine.id, name: routine.name, botId: routine.botId, instructions: routine.prompt, enabled: routine.enabled,
      when: scheduleLabel(routine.schedule), next, lastFire: fires[0], firesToday };
  }
  const webhook = sources.webhooks.find((candidate) => candidate.id === ref.id);
  if (!webhook) return null;
  const events = webhook.eventTypes?.length ? ` (${webhook.eventTypes.join(", ")})` : "";
  return { kind: "webhook", id: webhook.id, name: webhook.name, botId: webhook.botId, instructions: webhook.prompt, enabled: webhook.enabled,
    when: `When its link is called${events}`, next: fires.length || webhook.deliveryCount ? undefined : "Waiting for the first call", lastFire: fires[0], firesToday };
}

/** One line of a run's outcome for the card: what it needs, what went wrong, or the first line of its report. */
export function fireSummary(run: RoutineRun): string {
  const text = run.attention || run.error || run.output || "";
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}
