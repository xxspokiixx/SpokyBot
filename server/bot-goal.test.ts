import { describe, expect, it } from "vitest";

import { GOAL_MARKER_CLOSE, GOAL_MARKER_OPEN, GOAL_MAX_TURNS, type ThreadGoal } from "../shared/bot-goal.ts";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { BotGoalRefused, createBotGoals } from "./bot-goal.ts";

const done = (detail = "all green") => `${GOAL_MARKER_OPEN}{"status":"completed","detail":"${detail}"}${GOAL_MARKER_CLOSE}`;

function fixture(seed?: { goal?: unknown; routine?: boolean }) {
  const task: { threadId: string; goal?: unknown; routineRunId?: string } = { threadId: "t1", goal: seed?.goal, ...(seed?.routine ? { routineRunId: "r1" } : {}) };
  const bot = { id: "b1", tasks: [task] };
  const messages: Array<{ id: string; role: string; kind: string; text?: string; turnId?: string }> = [];
  const listeners: Array<(event: RuntimeEvent) => void> = [];
  const prompts: string[] = [];
  const state = { idle: true, now: 10_000, failStart: false, dispatchError: undefined as undefined | ((m: string) => void) };
  const goals = createBotGoals({
    store: {
      bots: [bot],
      botByThread: (threadId: string) => (threadId === "t1" ? bot : undefined),
      taskByThread: (botId: string, threadId: string) => (botId === "b1" && threadId === "t1" ? task : undefined),
      patchTask: (_b: string, _t: string, patch: { goal?: unknown }) => { task.goal = patch.goal; return task; },
      activePath: () => messages,
      patchMessage: (_t: string, id: string, patch: { text?: string }) => { Object.assign(messages.find((m) => m.id === id)!, patch); return null; },
    } as never,
    subscribe: (fn) => listeners.push(fn),
    ignore: () => false,
    idle: () => state.idle,
    start: (_b, _t, prompt, onDispatchError) => {
      prompts.push(prompt);
      state.idle = false;
      state.dispatchError = onDispatchError;
      return state.failStart ? Promise.reject(new Error("engine gone")) : Promise.resolve();
    },
    now: () => state.now,
  });
  const complete = (turnId: string, reply: string, extra: Partial<Extract<RuntimeEvent, { type: "turn.completed" }>> = {}, idleAfter = true) => {
    messages.push({ id: `m-${turnId}`, role: "bot", kind: "text", text: reply, turnId });
    state.idle = idleAfter;
    for (const fn of listeners) fn({ type: "turn.completed", threadId: "t1", turnId, ok: true, ...extra } as RuntimeEvent);
  };
  const goal = () => task.goal as ThreadGoal | undefined;
  return { goals, complete, goal, prompts, state, messages };
}

describe("bot goal host", () => {
  it("starts a turn at once, then one continuation per clean turn until the bot reports done", () => {
    const f = fixture();
    f.goals.set("b1", "t1", "get all tests passing");
    expect(f.prompts).toHaveLength(1);
    expect(f.prompts[0]).toContain("goal turn 1 of at most 10");
    expect(f.goal()).toMatchObject({ status: "active", turns: 1 });

    f.complete("a", "fixed two tests");
    expect(f.prompts).toHaveLength(2);
    expect(f.prompts[1]).toContain("goal turn 2");

    f.complete("b", `everything passes\n${done()}`);
    expect(f.prompts).toHaveLength(2);
    expect(f.goal()).toMatchObject({ status: "complete", detail: "all green" });
    expect(f.messages.at(-1)!.text).toBe("everything passes");
  });

  it("does not start a second turn for a repeated completion of the same turn", () => {
    const f = fixture();
    f.goals.set("b1", "t1", "g");
    f.complete("a", "step");
    f.state.idle = true;
    f.complete("a", "step");
    expect(f.prompts).toHaveLength(2);
  });

  it("pauses on Stop and never continues, even when the interrupted turn then settles", () => {
    const f = fixture();
    f.goals.set("b1", "t1", "g");
    f.goals.stopped("t1");
    expect(f.goal()).toMatchObject({ status: "paused", reason: "stopped" });
    f.complete("a", "partial", { ok: false, stopReason: "interrupted" });
    expect(f.prompts).toHaveLength(1);
  });

  it("pauses instead of continuing after a failed turn or an interrupted settle", () => {
    const failed = fixture();
    failed.goals.set("b1", "t1", "g");
    failed.complete("a", "", { ok: false });
    expect(failed.goal()).toMatchObject({ status: "paused", reason: "failed" });
    expect(failed.prompts).toHaveLength(1);

    const interrupted = fixture();
    interrupted.goals.set("b1", "t1", "g");
    interrupted.complete("a", "", { ok: false, stopReason: "interrupted" });
    expect(interrupted.goal()).toMatchObject({ status: "paused", reason: "stopped" });
    expect(interrupted.prompts).toHaveLength(1);
  });

  it("pauses when the turn could not start", async () => {
    const f = fixture();
    f.state.failStart = true;
    f.goals.set("b1", "t1", "g");
    await Promise.resolve();
    await Promise.resolve();
    expect(f.goal()).toMatchObject({ status: "paused", reason: "failed", detail: "engine gone" });
    const second = fixture();
    second.goals.set("b1", "t1", "g");
    second.state.dispatchError!("no capacity");
    expect(second.goal()).toMatchObject({ status: "paused", reason: "failed", detail: "no capacity" });
  });

  it("waits for a busy conversation and continues after the person's own turn", () => {
    const f = fixture();
    f.state.idle = false;
    f.goals.set("b1", "t1", "g");
    expect(f.prompts).toHaveLength(0);
    f.complete("person-turn", "their answer");
    expect(f.prompts).toHaveLength(1);
  });

  it("holds a due continuation while the person's queued message runs, then fires exactly one", () => {
    const f = fixture();
    f.goals.set("b1", "t1", "g");
    f.complete("a", "step", {}, false);
    expect(f.prompts).toHaveLength(1);
    f.complete("person-turn", "answer to the queued message");
    expect(f.prompts).toHaveLength(2);
    expect(f.goal()).toMatchObject({ status: "active", turns: 2 });
  });

  it("pauses at the turn limit", () => {
    const f = fixture();
    f.goals.set("b1", "t1", "g");
    for (let turn = 1; turn < GOAL_MAX_TURNS; turn += 1) f.complete(`t${turn}`, "more");
    expect(f.prompts).toHaveLength(GOAL_MAX_TURNS);
    f.complete("last", "still going");
    expect(f.prompts).toHaveLength(GOAL_MAX_TURNS);
    expect(f.goal()).toMatchObject({ status: "paused", reason: "limit" });
    f.goals.resume("t1");
    expect(f.prompts).toHaveLength(GOAL_MAX_TURNS + 1);
    expect(f.goal()).toMatchObject({ status: "active", turns: 1 });
  });

  it("pauses at the wall-time limit", () => {
    const f = fixture();
    f.goals.set("b1", "t1", "g");
    f.state.now += 3 * 60 * 60 * 1000;
    f.complete("a", "slow");
    expect(f.goal()).toMatchObject({ status: "paused", reason: "time" });
    expect(f.prompts).toHaveLength(1);
  });

  it("pause, resume and clear are the person's", () => {
    const f = fixture();
    f.goals.set("b1", "t1", "g");
    f.goals.pause("t1");
    f.complete("a", "step");
    expect(f.prompts).toHaveLength(1);
    expect(f.goal()).toMatchObject({ status: "paused", reason: "person" });
    f.goals.resume("t1");
    expect(f.prompts).toHaveLength(2);
    f.goals.clear("t1");
    expect(f.goal()).toBeUndefined();
    f.complete("b", "step");
    expect(f.prompts).toHaveLength(2);
  });

  it("parks on needs-input and blocked without another turn", () => {
    const f = fixture();
    f.goals.set("b1", "t1", "g");
    f.complete("a", `which database?\n${GOAL_MARKER_OPEN}{"status":"needs-input","detail":"which database?"}${GOAL_MARKER_CLOSE}`);
    expect(f.goal()).toMatchObject({ status: "paused", reason: "needs-input" });
    expect(f.prompts).toHaveLength(1);
  });

  it("refuses a routine run and an empty goal", () => {
    expect(() => fixture({ routine: true }).goals.set("b1", "t1", "g")).toThrow(BotGoalRefused);
    expect(() => fixture().goals.set("b1", "t1", "  ")).toThrow(BotGoalRefused);
    expect(() => fixture().goals.set("b1", "other", "g")).toThrow(BotGoalRefused);
  });

  it("restores an active goal as paused after a restart and drops a corrupt one", () => {
    const active: ThreadGoal = { text: "g", status: "active", turns: 3, maxTurns: 10, startedAt: 1, updatedAt: 1 };
    const restarted = fixture({ goal: active });
    expect(restarted.goal()).toMatchObject({ status: "paused", reason: "restarted", turns: 3 });
    expect(restarted.prompts).toHaveLength(0);
    expect(fixture({ goal: { status: "active", text: 4 } }).goal()).toBeUndefined();
  });
});
