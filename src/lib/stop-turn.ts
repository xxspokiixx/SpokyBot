// One Stop per press. The desktop learns each thread's running turn from its live runtime frames and names it in
// the Stop, so a Stop the server receives after that turn ended reaches nothing (it answers "already-stopped")
// instead of the queued message that started next. A repeat within a second, the second click of a double click,
// never leaves this client at all.
import type { RuntimeEvent } from "../../shared/runtime-events";

export const STOP_REPEAT_MS = 1_000;

const liveTurns = new Map<string, string>();
const lastStops = new Map<string, number>();

/** Follows turn.started and turn.completed frames; a thread between turns has no live turn to name. */
export function noteRuntimeTurn(event: Pick<RuntimeEvent, "type" | "threadId" | "turnId">): void {
  if (!event.turnId) return;
  if (event.type === "turn.started") liveTurns.set(event.threadId, event.turnId);
  else if (event.type === "turn.completed" && liveTurns.get(event.threadId) === event.turnId) liveTurns.delete(event.threadId);
}

/** Tests only: start from no live turns and no recent Stops. */
export function forgetStops(): void {
  liveTurns.clear();
  lastStops.clear();
}

type StopAction = { type: "interrupt"; botId: string; threadId?: string; onError?: () => void };
type Api = (path: string, init?: RequestInit) => Promise<unknown>;

export function sendStop(api: Api, action: StopAction, showError: (error: unknown) => void): void {
  const key = action.threadId ?? `bot:${action.botId}`;
  const now = Date.now();
  const last = lastStops.get(key);
  if (last !== undefined && now - last < STOP_REPEAT_MS) return;
  lastStops.set(key, now);
  const turnId = action.threadId ? liveTurns.get(action.threadId) : undefined;
  api(`/api/bots/${action.botId}/interrupt`, {
    method: "POST",
    body: action.threadId ? JSON.stringify({ threadId: action.threadId, ...(turnId ? { turnId } : {}) }) : undefined,
  }).catch((error) => {
    // Refused: the next press is a new Stop, not a repeat.
    if (lastStops.get(key) === now) lastStops.delete(key);
    showError(error);
    action.onError?.();
  });
}
