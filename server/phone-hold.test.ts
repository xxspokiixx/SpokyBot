import { afterEach, describe, expect, it, vi } from "vitest";

import { createPhoneHold, PHONE_HOLD_WAIT_MS } from "./phone-hold.ts";

const LIMITS = { graceMs: 2 * 60_000, idleMs: 5 * 60_000 };

afterEach(() => { vi.useRealTimers(); });

describe("a person's hold on the phone", () => {
  it("starts free, and a call that needs it finds it free", async () => {
    const hold = createPhoneHold({ limits: LIMITS });
    expect(hold.held).toBe(false);
    expect(await hold.wait(new AbortController().signal, 1_000)).toBe("free");
  });

  it("refuses a bot's call while it is held, and lets one through the moment it is handed back", async () => {
    vi.useFakeTimers();
    const hold = createPhoneHold({ limits: LIMITS });
    const changes: boolean[] = [];
    const watched = createPhoneHold({ limits: LIMITS, onChange: (held) => changes.push(held) });
    hold.take();
    expect(hold.held).toBe(true);
    const waiting = hold.wait(new AbortController().signal, PHONE_HOLD_WAIT_MS);
    hold.release();
    expect(await waiting).toBe("handed-back");
    expect(hold.held).toBe(false);
    // The change listener hears both sides, for a screen that shows the hold.
    watched.take(); watched.release();
    expect(changes).toEqual([true, false]);
  });

  it("gives up waiting when its own budget passes, or the turn is cancelled", async () => {
    vi.useFakeTimers();
    const hold = createPhoneHold({ limits: LIMITS });
    hold.take();
    const timed = hold.wait(new AbortController().signal, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await timed).toBe("held");

    const controller = new AbortController();
    const cancelled = hold.wait(controller.signal, PHONE_HOLD_WAIT_MS);
    controller.abort();
    expect(await cancelled).toBe("held");
  });

  it("ends on its own: the idle time after the last input, and the grace after the last view closed", async () => {
    vi.useFakeTimers();
    const idle = createPhoneHold({ limits: LIMITS });
    idle.take();
    await vi.advanceTimersByTimeAsync(LIMITS.idleMs - 1);
    expect(idle.held, "still within the idle time").toBe(true);
    await vi.advanceTimersByTimeAsync(2);
    expect(idle.held).toBe(false);

    const grace = createPhoneHold({ limits: LIMITS });
    grace.take();
    grace.watched(true);
    grace.watched(false);
    await vi.advanceTimersByTimeAsync(LIMITS.graceMs - 1);
    expect(grace.held).toBe(true);
    await vi.advanceTimersByTimeAsync(2);
    expect(grace.held).toBe(false);
  });

  it("keeps the hold alive while the person types", async () => {
    vi.useFakeTimers();
    const hold = createPhoneHold({ limits: LIMITS });
    hold.take();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(LIMITS.idleMs - 1_000);
      hold.used();
    }
    expect(hold.held).toBe(true);
  });

  it("releases everyone waiting when the server stops, and keeps nothing held", async () => {
    const hold = createPhoneHold({ limits: LIMITS });
    hold.take();
    const waiting = hold.wait(new AbortController().signal, PHONE_HOLD_WAIT_MS);
    hold.stop();
    expect(await waiting).toBe("handed-back");
    expect(hold.held).toBe(false);
  });
});
