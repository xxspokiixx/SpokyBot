import {
  afterTurn, goalPrompt, newGoal, parseGoalSignal, pauseGoal, readStoredGoal, resumeGoal, startGoalTurn,
  type GoalSignal, type ThreadGoal,
} from "../shared/bot-goal.ts";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import type { Store } from "./store.ts";

export interface BotGoalDeps {
  store: Pick<Store, "bots" | "botByThread" | "taskByThread" | "patchTask" | "activePath" | "patchMessage">;
  subscribe(listener: (event: RuntimeEvent) => void): unknown;
  ignore(event: RuntimeEvent): boolean;
  /** Nothing else is running, queued or waiting on the person for this conversation. */
  idle(botId: string, threadId: string): boolean;
  /** Runs one turn whose prompt is control-plane text, never a line the person wrote. */
  start(botId: string, threadId: string, prompt: string, onDispatchError: (message: string) => void): Promise<unknown>;
  now?(): number;
}

export class BotGoalRefused extends Error {
  readonly status = 409;
}

/** Keeps a standing goal going, one turn at a time: a settled turn that ended well and did not report the goal done
 * asks for exactly one more, only once the conversation is otherwise idle. */
export function createBotGoals(deps: BotGoalDeps) {
  const { store } = deps;
  const now = () => deps.now?.() ?? Date.now();
  const due = new Set<string>();
  const launching = new Set<string>();
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
    if (!bot || goal?.status !== "active" || launching.has(threadId)) { due.delete(threadId); return; }
    if (!deps.idle(bot.id, threadId)) return;
    const gate = afterTurn(goal, { ok: true, stopped: false, signal: null }, now());
    due.delete(threadId);
    if (!gate.run) { save(threadId, gate.goal); return; }
    const running = startGoalTurn(goal, now());
    save(threadId, running);
    launching.add(threadId);
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

  function signalOf(threadId: string, turnId: string | undefined): GoalSignal | null {
    const reply = store.activePath(threadId).findLast((m) => m.role === "bot" && m.kind === "text" && (turnId === undefined || m.turnId === turnId));
    if (!reply?.text) return null;
    const { visibleText, signal } = parseGoalSignal(reply.text);
    if (visibleText !== reply.text) store.patchMessage(threadId, reply.id, { text: visibleText });
    return signal;
  }

  deps.subscribe((event) => {
    if (event.type !== "turn.completed" || deps.ignore(event)) return;
    launching.delete(event.threadId);
    const goal = read(event.threadId);
    if (goal?.status === "active" && (event.turnId === undefined || handled.get(event.threadId) !== event.turnId)) {
      if (event.turnId !== undefined) handled.set(event.threadId, event.turnId);
      const signal = signalOf(event.threadId, event.turnId);
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
