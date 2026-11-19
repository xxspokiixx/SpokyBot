import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { crashVerdict, currentTurn, FATAL_EXIT_DEADLINE_MS, installCrashGuard, runInTurn, STORM_LIMIT, STORM_WINDOW_MS, withTurnScope } from "./crash-guard.ts";
import type { ProviderInstance } from "./contracts.ts";
import { CRASH_EXIT_CODE } from "./restart.ts";

const peerGone = (code: string) => Object.assign(new Error("socket hang up"), { code });

function rig(turnRunning = true) {
  const events = new EventEmitter();
  const calls = { failed: [] as string[], shutdown: [] as number[], exit: [] as number[], log: [] as string[] };
  let clock = 0;
  installCrashGuard({
    failTurn: (turn) => { calls.failed.push(turn.threadId); return turnRunning; },
    shutdown: (code) => calls.shutdown.push(code),
    exit: (code) => calls.exit.push(code),
    log: (line) => calls.log.push(line),
    redact: (text) => text.replaceAll("sk-secret", "[redacted]"),
    now: () => clock,
    on: (event, listener) => events.on(event, listener),
  });
  return { calls, raise: (kind: "uncaughtException" | "unhandledRejection", error: unknown) => events.emit(kind, error), tick: (ms: number) => { clock += ms; } };
}

afterEach(() => { vi.useRealTimers(); });

describe("the crash guard's rule", () => {
  it("stops only the turn an error came from, keeps the server up for a rejection or a peer gone, and closes for anything else", () => {
    const turn = { botId: "b", threadId: "t" };
    expect(crashVerdict("exception", new TypeError("x"), turn, 1)).toBe("fail-turn");
    expect(crashVerdict("rejection", new TypeError("x"), turn, 1)).toBe("fail-turn");
    expect(crashVerdict("rejection", new TypeError("x"), undefined, 1)).toBe("keep");
    expect(crashVerdict("exception", peerGone("EPIPE"), undefined, 1)).toBe("keep");
    expect(crashVerdict("exception", peerGone("ECONNRESET"), undefined, 1)).toBe("keep");
    expect(crashVerdict("exception", new TypeError("x"), undefined, 1)).toBe("exit");
    expect(crashVerdict("exception", new RangeError("Maximum call stack size exceeded"), turn, 1)).toBe("exit");
    expect(crashVerdict("rejection", new TypeError("x"), turn, STORM_LIMIT + 1)).toBe("exit");
  });

  it("knows the turn an error came from across a timer and a promise started inside it", async () => {
    const seen: Array<string | undefined> = [];
    await runInTurn({ botId: "b", threadId: "t1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(currentTurn()?.threadId);
      await Promise.resolve().then(() => seen.push(currentTurn()?.threadId));
    });
    seen.push(currentTurn()?.threadId);
    expect(seen).toEqual(["t1", "t1", undefined]);
  });
});

describe("installCrashGuard", () => {
  it("stops the turn and keeps the server up when a turn's own work throws or rejects", async () => {
    const { calls, raise } = rig();
    await runInTurn({ botId: "b", threadId: "t1" }, async () => {
      await Promise.resolve();
      raise("uncaughtException", new TypeError("cannot read properties of undefined (sk-secret)"));
      raise("unhandledRejection", new Error("later"));
    });
    expect(calls.failed).toEqual(["t1", "t1"]);
    expect(calls.shutdown).toEqual([]);
    expect(calls.exit).toEqual([]);
    expect(calls.log.join("\n")).not.toContain("sk-secret");
  });

  it("keeps the server up for a rejection and for a peer that went away, and closes for anything else", () => {
    const { calls, raise } = rig();
    raise("unhandledRejection", new TypeError("nobody listened"));
    raise("uncaughtException", peerGone("ECONNRESET"));
    expect(calls.shutdown).toEqual([]);
    expect(calls.exit).toEqual([]);
    raise("uncaughtException", new TypeError("in shared code"));
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
  });

  it("closes when a turn's error arrives after that turn ended: nothing is left to stop", async () => {
    const { calls, raise } = rig(false);
    await runInTurn({ botId: "b", threadId: "warm" }, async () => {
      await Promise.resolve();
      raise("uncaughtException", new TypeError("late callback"));
    });
    expect(calls.failed).toEqual(["warm"]);
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
  });

  it("ends the process at the deadline even when the close hangs, and exits at once on a second error", () => {
    vi.useFakeTimers();
    const { calls, raise } = rig();
    raise("uncaughtException", new TypeError("fatal"));
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
    raise("uncaughtException", new TypeError("during the close"));
    expect(calls.exit).toEqual([CRASH_EXIT_CODE]);
    vi.advanceTimersByTime(FATAL_EXIT_DEADLINE_MS);
    expect(calls.exit).toEqual([CRASH_EXIT_CODE, CRASH_EXIT_CODE]);
  });

  it("treats a storm of errors as fatal, so a failing loop cannot keep a broken server up", () => {
    const { calls, raise, tick } = rig();
    for (let i = 0; i <= STORM_LIMIT; i++) {
      raise("unhandledRejection", new TypeError("looping"));
      tick(STORM_WINDOW_MS / (STORM_LIMIT + 2));
    }
    expect(calls.shutdown).toEqual([CRASH_EXIT_CODE]);
  });

  it("wraps a driver so its turn's errors are the turn's, and its events run outside that scope", async () => {
    const seen: Array<string | undefined> = [];
    const instance = withTurnScope({ adapter: {
      sendTurn: async () => { seen.push(currentTurn()?.threadId); return { turnId: "turn-1" }; },
      onEvent: (listener: (event: unknown) => void) => { listener({}); return () => {}; },
    } } as unknown as Pick<ProviderInstance, "adapter">);
    await instance.adapter.sendTurn({ threadId: "t9", botId: "b" } as never);
    instance.adapter.onEvent(() => seen.push(currentTurn()?.threadId));
    expect(seen).toEqual(["t9", undefined]);
  });
});
