// Who may use a Mac lent to an OMB Cloud home (docs/cloud-pro.md, "Let my
// Cloud use this Mac"). A Cloud home is one person's server, but not every
// turn on it is theirs: a guest the owner paired, a webhook's payload, or a
// line someone else slipped into a running turn must never reach the Mac.
//
// A turn may use the lent Mac only when the harness can prove it acts for the
// owner:
// - a conversation the owner started from one of their own devices (a live
//   session with admin scope), or
// - a scheduled run of a routine whose instructions the owner wrote (created
//   or edited from one of those devices), or a run the owner started by hand;
// and nobody else's words have been added to it since. Webhook runs, guests,
// rooms, a bot's delegated or peer turn, and anything unprovable never can.
// Everything here is pure; server/index.ts supplies the records.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import type { RoutineRunTrigger } from "./routines.ts";

type Line = { id: string; role: string; peerAsk?: unknown; sender?: { id?: string } };

export interface CloudLendingTurn {
  /** The harness's record of the request that started this turn. */
  request: { messageId?: string; generations: ReadonlySet<string>; stopped?: boolean; automation?: RoutineRunTrigger } | undefined;
  generation: string;
  thread: readonly Line[];
  /** Whether a person key is one of the owner's own devices right now. */
  ownerPerson: (person: string | undefined) => boolean;
  /** The routine run executing on this turn's thread, when there is one. */
  routineRun: () => { triggerSource: RoutineRunTrigger; ownerStarted: boolean; ownerAuthored: boolean } | null;
}

const personOf = (line: Line | undefined) => line?.role === "user" && !line.peerAsk ? line.sender?.id : undefined;

export function cloudHomeTurnMayLend(turn: CloudLendingTurn): boolean {
  const { request } = turn;
  if (!request?.messageId || request.stopped || !request.generations.has(turn.generation)) return false;
  const index = turn.thread.findIndex(line => line.id === request.messageId);
  if (index < 0) return false;
  let owner: boolean;
  if (request.automation === undefined) {
    owner = turn.ownerPerson(personOf(turn.thread[index]));
  } else {
    const run = turn.routineRun();
    owner = request.automation !== "webhook" && Boolean(run) && run!.triggerSource !== "webhook" &&
      run!.ownerAuthored && (run!.triggerSource !== "manual" || run!.ownerStarted);
  }
  // Nothing anyone else wrote (a guest, a teammate bot, a local process) may
  // have been steered, queued or handed into this turn since it started.
  return owner && turn.thread.slice(index + 1).every(line => line.role !== "user" || turn.ownerPerson(personOf(line)));
}

/** What a routine run does, reduced to what its author decides. A run
 * snapshots these from its routine, so an edit by anyone else changes it. */
export function routineFingerprint(routine: { prompt?: string; target?: unknown; botId?: string; groupId?: string; attachments?: { id: string; path: string }[] }): string {
  const attachments = (routine.attachments ?? []).map(attachment => [attachment.id, attachment.path]);
  return createHash("sha256").update(JSON.stringify([routine.prompt ?? "", routine.target ?? null, routine.botId ?? "", routine.groupId ?? null, attachments])).digest("hex");
}

const authorsFile = z.object({ version: z.literal(1), routines: z.record(z.string().max(128), z.string().regex(/^[a-f0-9]{64}$/)) }).strict();

/** Which routines the owner wrote, as the fingerprint of what they wrote.
 * Persisted beside the routines (owner-only). A missing or damaged file
 * means none: it never grants anything by being absent. */
export function createCloudRoutineAuthors(file: string) {
  let routines: Record<string, string> = {};
  try {
    if (existsSync(file)) {
      const stat = lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1_000_000) routines = authorsFile.parse(JSON.parse(readFileSync(file, "utf8"))).routines;
    }
  } catch { routines = {}; }
  const save = () => writeFileAtomic(file, JSON.stringify({ version: 1, routines }), { mode: 0o600 });
  return {
    /** The owner wrote this routine as it stands now. */
    record(id: string, routine: Parameters<typeof routineFingerprint>[0]) { routines = { ...routines, [id]: routineFingerprint(routine) }; save(); },
    forget(id: string) { if (Object.hasOwn(routines, id)) { const next = { ...routines }; delete next[id]; routines = next; save(); } },
    /** Whether this routine, as it stands (or as a run snapshotted it), is
     * exactly what the owner wrote. */
    authored(id: string, routine: Parameters<typeof routineFingerprint>[0]) { return Object.hasOwn(routines, id) && routines[id] === routineFingerprint(routine); },
  };
}
