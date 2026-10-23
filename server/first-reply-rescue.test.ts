import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEvent } from "./contracts.ts";
import { DEFAULT_QUIET_NOTICE_MS } from "./drivers/acp/quiet-status.ts";
import { createFirstReplyRescue, DEFAULT_FIRST_REPLY_NOTICE_MS } from "./first-reply-rescue.ts";
import type { Message } from "./store.ts";

const THREAD = "thread-1";
const BOT = { id: "bot-1", name: "Maus", modelSelection: { instanceId: "opencodeGo", model: "free" } };

const event = (fields: Record<string, unknown>): RuntimeEvent =>
  ({ eventId: `e-${Math.random()}`, provider: "opencodeGo", threadId: THREAD, createdAt: "", ...fields }) as unknown as RuntimeEvent;
const started = (turnId = "turn-1", threadId = THREAD) => event({ type: "turn.started", turnId, threadId });

function harness(options: { quiet?: boolean; speaker?: { botId: string; name: string; color: string } } = {}) {
  const rows = new Map<string, Message[]>();
  const append = vi.fn((threadId: string, message: Omit<Message, "id" | "at">) => {
    const row = { ...message, id: `m-${(rows.get(threadId)?.length ?? 0) + 1}`, at: Date.now() } as Message;
    rows.set(threadId, [...(rows.get(threadId) ?? []), row]);
    return row;
  });
  const patch = vi.fn((threadId: string, messageId: string, change: Partial<Message>) => {
    const list = rows.get(threadId) ?? [];
    const index = list.findIndex((row) => row.id === messageId);
    if (index < 0) return null;
    list[index] = { ...list[index]!, ...change };
    return list[index]!;
  });
  const rescue = createFirstReplyRescue({
    store: {
      appendMessage: append,
      patchMessage: patch,
      botByThread: (threadId) => (threadId === THREAD ? BOT : undefined) as never,
      bot: (id) => (id === BOT.id ? BOT : undefined) as never,
      groupByThread: () => (options.speaker ? { id: "room-1" } : undefined) as never,
    },
    botForThread: (botId) => (botId === BOT.id ? BOT : null) as never,
    speaker: () => options.speaker,
    runningEngine: () => "opencodeGo",
    engineName: (instanceId) => (instanceId === "opencodeGo" ? "OpenCode" : instanceId),
    quiet: () => options.quiet === true,
  });
  return { rescue, rows: (threadId = THREAD) => rows.get(threadId) ?? [], append, patch };
}

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.OMB_FIRST_REPLY_NOTICE_MS;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.OMB_FIRST_REPLY_NOTICE_MS;
});

describe("first-reply rescue", () => {
  it("posts one notice 20 s into a turn that has heard nothing from the AI", () => {
    const { rescue, rows } = harness();
    rescue.onEvent(started());
    rescue.onEvent(event({ type: "session.started", turnId: "turn-1", sessionId: "s" }));
    vi.advanceTimersByTime(19_999);
    expect(rows()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      role: "bot", kind: "activity", turnId: "turn-1",
      tool: {
        // The plain line every older client (the phones) prints as it is.
        name: "notice: Maus hasn't heard back from OpenCode yet.",
        ok: true,
        rescue: { botId: "bot-1", threadId: THREAD, instanceId: "opencodeGo", ai: "OpenCode" },
      },
    });
    expect(rows()[0]!.tool!.rescue!.settled).toBeUndefined();
    vi.advanceTimersByTime(10 * 60_000);
    expect(rows()).toHaveLength(1);
  });

  it.each([
    ["thinking", { type: "content.delta", streamKind: "reasoning_text", delta: "hm" }],
    ["text", { type: "content.delta", streamKind: "assistant_text", delta: "Hi" }],
    ["a tool call", { type: "item.started", itemType: "tool", title: "Read" }],
    ["progress", { type: "item.updated", itemType: "reasoning", tokens: 12 }],
    ["a reply", { type: "item.completed", itemType: "assistant_text", text: "Hi" }],
    ["a question", { type: "request.opened", requestType: "question", tool: "ask", summary: "Which?" }],
  ])("stays out of a turn whose AI sent %s before 20 s", (_label, output) => {
    const { rescue, rows } = harness();
    rescue.onEvent(started());
    vi.advanceTimersByTime(5_000);
    rescue.onEvent(event({ turnId: "turn-1", ...output }));
    vi.advanceTimersByTime(10 * 60_000);
    expect(rows()).toEqual([]);
  });

  it("settles the notice once the reply starts after it", () => {
    const { rescue, rows } = harness();
    rescue.onEvent(started());
    vi.advanceTimersByTime(20_000);
    expect(rows()).toHaveLength(1);
    rescue.onEvent(event({ type: "content.delta", turnId: "turn-1", streamKind: "assistant_text", delta: "Hello" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.tool).toMatchObject({
      name: "notice: OpenCode answered after a slow start.",
      ok: true,
      rescue: { botId: "bot-1", instanceId: "opencodeGo", ai: "OpenCode", settled: true },
    });
    rescue.onEvent(event({ type: "item.completed", turnId: "turn-1", itemType: "assistant_text", text: "Hello" }));
    expect(rows()).toHaveLength(1);
  });

  it("never posts a second notice in the same turn, and watches the next turn afresh", () => {
    const { rescue, rows } = harness();
    rescue.onEvent(started("turn-1"));
    vi.advanceTimersByTime(20_000);
    rescue.onEvent(event({ type: "turn.retrying", turnId: "turn-1", attempt: 1, delayMs: 1_000, reason: "overloaded" }));
    rescue.onEvent(started("turn-1"));
    vi.advanceTimersByTime(60_000);
    expect(rows()).toHaveLength(1);
    rescue.onEvent(event({ type: "turn.completed", turnId: "turn-1", ok: false }));
    rescue.onEvent(started("turn-2"));
    vi.advanceTimersByTime(20_000);
    expect(rows().map((row) => row.turnId)).toEqual(["turn-1", "turn-2"]);
  });

  it("leaves mid-turn quiet to the engine's own notices", () => {
    const { rescue, rows } = harness();
    rescue.onEvent(started());
    vi.advanceTimersByTime(3_000);
    rescue.onEvent(event({ type: "item.started", turnId: "turn-1", itemType: "tool", title: "Read" }));
    vi.advanceTimersByTime(30 * 60_000);
    expect(rows()).toEqual([]);
    // The ACP quiet watch still speaks first at 60 s, well after this 20 s rescue.
    expect(DEFAULT_QUIET_NOTICE_MS).toBe(60_000);
    expect(DEFAULT_FIRST_REPLY_NOTICE_MS).toBe(20_000);
  });

  it("takes its delay from OMB_FIRST_REPLY_NOTICE_MS", () => {
    process.env.OMB_FIRST_REPLY_NOTICE_MS = "5000";
    const { rescue, rows } = harness();
    rescue.onEvent(started());
    vi.advanceTimersByTime(4_999);
    expect(rows()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(rows()).toHaveLength(1);
  });

  it("is off when OMB_FIRST_REPLY_NOTICE_MS is 0", () => {
    process.env.OMB_FIRST_REPLY_NOTICE_MS = "0";
    const { rescue, rows } = harness();
    rescue.onEvent(started());
    vi.advanceTimersByTime(10 * 60_000);
    expect(rows()).toEqual([]);
  });

  it("ignores another turn's or another thread's output", () => {
    const { rescue, rows } = harness();
    rescue.onEvent(started("turn-1"));
    rescue.onEvent(event({ type: "content.delta", turnId: "turn-0", streamKind: "assistant_text", delta: "late" }));
    rescue.onEvent(event({ type: "content.delta", turnId: "turn-9", threadId: "thread-2", streamKind: "assistant_text", delta: "x" }));
    vi.advanceTimersByTime(20_000);
    expect(rows()).toHaveLength(1);
  });

  it("says nothing for a turn that ended or failed before 20 s", () => {
    const { rescue, rows } = harness();
    rescue.onEvent(started("turn-1"));
    vi.advanceTimersByTime(2_000);
    rescue.onEvent(event({ type: "turn.completed", turnId: "turn-1", ok: true, stopReason: "cancelled" }));
    rescue.onEvent(started("turn-2"));
    rescue.onEvent(event({ type: "runtime.error", turnId: "turn-2", message: "OpenCode is signed out." }));
    vi.advanceTimersByTime(10 * 60_000);
    expect(rows()).toEqual([]);
  });

  it("does not count a wait for the computer as the AI's silence", () => {
    const { rescue, rows } = harness();
    rescue.onEvent(started());
    vi.advanceTimersByTime(15_000);
    rescue.onEvent(event({ type: "turn.wait_started", turnId: "turn-1", resource: "computer:local" }));
    vi.advanceTimersByTime(5 * 60_000);
    expect(rows()).toEqual([]);
    rescue.onEvent(event({ type: "turn.wait_ended", turnId: "turn-1", resource: "computer:local", waitedMs: 300_000, outcome: "acquired" }));
    vi.advanceTimersByTime(19_999);
    expect(rows()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(rows()).toHaveLength(1);
  });

  it("stays out of turns nobody is watching live", () => {
    const { rescue, rows } = harness({ quiet: true });
    rescue.onEvent(started());
    vi.advanceTimersByTime(10 * 60_000);
    expect(rows()).toEqual([]);
  });

  it("speaks from the speaking bot in a room", () => {
    const speaker = { botId: "bot-1", name: "Maus", color: "green" };
    const { rescue, rows } = harness({ speaker });
    rescue.onEvent(started());
    vi.advanceTimersByTime(20_000);
    expect(rows()[0]).toMatchObject({ from: speaker, tool: { rescue: { botId: "bot-1", groupId: "room-1" } } });
  });
});
