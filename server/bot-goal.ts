import {
  afterTurn, goalPrompt, newGoal, parseGoalSignal, pauseGoal, readStoredGoal, resumeGoal, startGoalTurn,
  type GoalSignal, type ThreadGoal,
} from "../shared/bot-goal.ts";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import type { Store } from "./store.ts";

export interface BotGoalDeps {
  store: Pick<Store, "bots" | "botByThread" | "taskByThread" | "patchTask">;
  subscribe(listener: (event: RuntimeEvent) => void): unknown;
  ignore(event: RuntimeEvent): boolean;
  /** Nothing else is running, queued or waiting on the person for this conversation. */
  idle(botId: string, threadId: string): boolean;
  /** Runs one turn whose prompt is control-plane text, never a line the person wrote. */
  start(botId: string, threadId: string, prompt: string, onDispatchError: (message: string) => void): Promise<unknown>;
  now?(): number;
}

/** A started goal turn that is not running and has not settled by now is gone. */
const LAUNCH_GRACE_MS = 60_000;

export class BotGoalRefused extends Error {
  readonly status = 409;
}

/** Keeps a standing goal going, one turn at a time: a settled turn that ended well and did not report the goal done
 * asks for exactly one more, only once the conversation is otherwise idle. */
export function createBotGoals(deps: BotGoalDeps) {
  const { store } = deps;
  const now = () => deps.now?.() ?? Date.now();
  const due = new Set<string>();
  const launching = new Map<string, number>();
  const handled = new Map<string, string>();

  const read = (threadId: string): ThreadGoal | null => readStoredGoal(store.botByThread(threadId)
    && store.taskByThread(store.botByThread(threadId)!.id, threadId)?.goal);
  const save = (threadId: string, goal: ThreadGoal | undefined): void => {
    const bot = store.botByThread(threadId);
    if (bot) store.patchTask(bot.id, threadId, { goal });
  };

  function launch(threadId: string): void {
    const bot = store.botByThread(threadId);
    const goal = read(threadId);
    if (!bot || goal?.status !== "active") { due.delete(threadId); return; }
    if (!deps.idle(bot.id, threadId)) return;
    const startedAt = launching.get(threadId);
    if (startedAt !== undefined) {
      if (now() - startedAt < LAUNCH_GRACE_MS) return;
      launching.delete(threadId);
      due.delete(threadId);
      save(threadId, pauseGoal(goal, "failed", now(), "the goal turn never finished"));
      return;
    }
    const gate = afterTurn(goal, { ok: true, stopped: false, signal: null }, now());
    due.delete(threadId);
    if (!gate.run) { save(threadId, gate.goal); return; }
    const running = startGoalTurn(goal, now());
    save(threadId, running);
    launching.set(threadId, now());
    due.add(threadId);
    const failed = (message: string) => {
      launching.delete(threadId);
      const current = read(threadId);
      if (current) save(threadId, pauseGoal(current, "failed", now(), message.slice(0, 200)));
    };
    deps.start(bot.id, threadId, goalPrompt(running), failed).catch((error: unknown) => failed(error instanceof Error ? error.message : String(error)));
  }

  function wake(): void {
    for (const threadId of due) launch(threadId);
  }

  const signals = new Map<string, GoalSignal | null>();

  deps.subscribe((event) => {
    if ((event.type !== "turn.completed" && event.type !== "session.exited") || deps.ignore(event)) return;
    if (event.type === "session.exited") {
      const goal = read(event.threadId);
      if (launching.delete(event.threadId) && goal?.status === "active") {
        due.delete(event.threadId);
        save(event.threadId, pauseGoal(goal, "failed", now(), "the engine session ended"));
      }
      return;
    }
    const signal = signals.get(event.threadId) ?? null;
    signals.delete(event.threadId);
    const fresh = event.turnId === undefined || handled.get(event.threadId) !== event.turnId;
    if (fresh) {
      launching.delete(event.threadId);
      if (event.turnId !== undefined) handled.set(event.threadId, event.turnId);
    }
    const goal = read(event.threadId);
    if (fresh && goal?.status === "active") {
      const next = afterTurn(goal, { ok: event.ok, stopped: event.stopReason === "interrupted", signal }, now());
      save(event.threadId, next.goal);
      if (next.run) due.add(event.threadId);
    }
    wake();
  });

  for (const bot of store.bots) {
    for (const task of bot.tasks ?? []) {
      const goal = readStoredGoal(task.goal);
      if (!goal && task.goal !== undefined) store.patchTask(bot.id, task.threadId, { goal: undefined });
      else if (goal?.status === "active") store.patchTask(bot.id, task.threadId, { goal: pauseGoal(goal, "restarted", now()) });
    }
  }

  return {
    get: read,
    /** The visible part of a bot reply as it is stored; the marker never reaches the transcript, a notification or a digest. */
    intake(threadId: string, text: string): string {
      if (!store.botByThread(threadId)) return text;
      const { visibleText, signal } = parseGoalSignal(text);
      signals.set(threadId, signal);
      return visibleText;
    },
    wake,
    set(botId: string, threadId: string, text: string): ThreadGoal {
      const task = store.taskByThread(botId, threadId);
      if (!task) throw new BotGoalRefused("a goal needs a conversation with a bot");
      if (task.routineRunId) throw new BotGoalRefused("a routine run cannot have a goal");
      const goal = newGoal(text, now());
      if (!goal) throw new BotGoalRefused("the goal is empty");
      save(threadId, goal);
      handled.delete(threadId);
      due.add(threadId);
      wake();
      return read(threadId) ?? goal;
    },
    pause(threadId: string): ThreadGoal | null {
      const goal = read(threadId);
      due.delete(threadId);
      if (goal) save(threadId, pauseGoal(goal, "person", now()));
      return read(threadId);
    },
    resume(threadId: string): ThreadGoal | null {
      const goal = read(threadId);
      if (goal?.status !== "paused") return goal;
      save(threadId, resumeGoal(goal, now()));
      due.add(threadId);
      wake();
      return read(threadId);
    },
    clear(threadId: string): void {
      due.delete(threadId);
      if (read(threadId)) save(threadId, undefined);
    },
    /** The person pressed Stop (or the turn was force-stopped): the goal waits for them. */
    stopped(threadId: string): void {
      const goal = read(threadId);
      due.delete(threadId);
      if (goal?.status === "active") save(threadId, pauseGoal(goal, "stopped", now()));
    },
  };
}

export type BotGoals = ReturnType<typeof createBotGoals>;
