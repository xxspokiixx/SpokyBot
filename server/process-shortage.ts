// A spawn the operating system refused for want of room (a container's pids limit, open files, memory) is this server's
// shortage, never the AI's failure: nothing was sent to a model, so nothing is retried on one or handed to a backup. On
// Android the same shortage is what the kernel's low-memory killer looks like a moment before it stops an engine.
import { engineFailureKind } from "./drivers/engine-errors.ts";
import { classifyError } from "./drivers/retry.ts";

/** spawn(2)/fork(2) failures that mean "no room now": EAGAIN (the pids limit or RLIMIT_NPROC), EMFILE and ENFILE (open
 * files), ENOMEM. */
const SHORTAGE_CODES: ReadonlySet<string> = new Set(["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"]);
export type ShortageCode = "EAGAIN" | "EMFILE" | "ENFILE" | "ENOMEM";

export function shortageCode(error: unknown): ShortageCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && SHORTAGE_CODES.has(code) ? (code as ShortageCode) : null;
}

/** The server's own words for it, and Node's error for a spawn it was refused, as a failure's first line. */
const NO_ROOM_NOTICE = /^There is no room to start another program \((?:EAGAIN|EMFILE|ENFILE|ENOMEM)\)/;
const SPAWN_REFUSED = /^(?:Error: )?(?:spawn failed: )?(?:posix_)?spawn(?:Sync)?\b[^\n]*\b(?:EAGAIN|EMFILE|ENFILE|ENOMEM)\b/;

/** Whether a failed turn's cause is the server's own refused spawn: the server's notice for it or Node's spawn error at the
 * head of the failure. Never an engine that exited on its own, whatever its stderr tail says (a file watcher's "EMFILE: too
 * many open files, watch"): that engine ran, and its turn may still go to a backup AI. */
export const outOfProcesses = (cause: string): boolean => NO_ROOM_NOTICE.test(cause) || SPAWN_REFUSED.test(cause);

const OWN_CAUSES: ReadonlySet<string> = new Set(["auth", "quota", "unknown_model", "provider_safety"]);

/** Whether a failure names its own cause (a usage limit, a sign-in, the provider's refusal, a tool server, a full disk, a
 * bot's memory cap): it is never relabelled as the server's shortage, though one was seen during the same turn. */
export function namesOwnCause(failure: string): boolean {
  if (engineFailureKind(failure) !== null || OWN_CAUSES.has(classifyError({ text: failure }).reason)) return true;
  return /\bfull disk\b|\bno space left\b|\bdisk is full\b|\bmemory cap\b|\btool server\b/i.test(failure);
}

/** What a person reads when a turn could not start because the machine had no room. Its opening words are the ones
 * `outOfProcesses` recognises, so the text read back from a failure still names this cause. */
export const NO_ROOM_TEXT = "There is no room to start another program (EAGAIN): this server is close to its limit on " +
  "running programs, so this turn could not start. Try again in a few minutes, or stop a bot you are not using.";
