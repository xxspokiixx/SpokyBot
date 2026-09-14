import type { TaskRecord } from "./store.ts";

/** Wire view of a task: the persisted record minus provider session
 * bookkeeping, plus the coordination wait flag below. */
export type WiredTask = Omit<TaskRecord, "resumeCursors" | "lastInstanceId"> & { waitingOnTeammate?: true };

/** True while this thread has handed work to a teammate that has not
 * settled yet (a live direct coordination handoff). */
export type ActiveCoordination = (threadId: string) => boolean;

/** Strip the harness's own session bookkeeping and surface the
 * coordination wait as data instead of a busy repaint (#1223).
 *
 * A thread waiting on a dispatched teammate is not working: its own turn
 * finished. The old wire repainted it busy/working, which ran the sidebar
 * spinner for the whole teammate run. The flag lets new clients show a
 * quiet wait while existing clients simply see the thread idle. */
export const wireTaskFor =
  (isActiveCoordination: ActiveCoordination) =>
  ({ resumeCursors: _resumeCursors, lastInstanceId: _lastInstanceId, ...task }: TaskRecord): WiredTask =>
    isActiveCoordination(task.threadId) && !task.busy ? { ...task, waitingOnTeammate: true } : task;
