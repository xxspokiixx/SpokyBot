// A person's hold on the phone the bots use. While it is taken, a bot's phone call is refused with words that tell it
// what happened, and it may wait for the hand-back instead of failing its turn. On a phone this is the difference
// between a bot that stops when its owner picks up the device and one that keeps tapping under their finger.
//
// The hold ends on a hand-back, `graceMs` after the person's last view closed, or `idleMs` after they last sent input,
// so a forgotten hold never outlives the person. It is a hold by PEOPLE only: the bots have their own per-turn claim
// (phone-proxy.ts), and the two never wait on each other.
import { HoldClock, type HoldLimits } from "./browser/hold.ts";

export type PhoneHoldWait = "free" | "held" | "handed-back";

export interface PhoneHold {
  readonly held: boolean;
  take(): void;
  release(): void;
  /** The holder sent input. */
  used(): void;
  /** Whether any view of the phone is open; with none, the grace runs. */
  watched(open: boolean): void;
  /** `"handed-back"` once the hold ends; `"held"` when `maxMs` passes or `signal` aborts first. */
  wait(signal: AbortSignal, maxMs: number): Promise<PhoneHoldWait>;
  stop(): void;
}

/** How long a bot's call waits for a person to hand the phone back: long enough for a real interruption, short enough
 * that a turn still ends. */
export const PHONE_HOLD_WAIT_MS = 45_000;

/** A person's hold on the bots' phone: one for every phone and every admin, as the bots share one claim on it. */
export function createPhoneHold(options: { limits?: HoldLimits; onChange?: (held: boolean) => void } = {}): PhoneHold {
  let held = false;
  const waiting = new Set<(outcome: PhoneHoldWait) => void>();
  const settleWaits = (outcome: PhoneHoldWait) => {
    for (const settle of waiting) settle(outcome);
  };
  const release = () => {
    if (!held) return;
    held = false;
    clock.stop();
    settleWaits("handed-back");
    options.onChange?.(false);
  };
  const clock = new HoldClock(release, options.limits);

  return {
    get held() {
      return held;
    },
    take() {
      if (!held) {
        held = true;
        options.onChange?.(true);
      }
      clock.used();
      // Taking it while nobody watches has no grace to wait for: the holder is here.
      clock.watched(true);
    },
    release,
    used() {
      if (held) clock.used();
    },
    watched(open) {
      if (held) clock.watched(open);
    },
    wait(signal, maxMs) {
      if (!held) return Promise.resolve("free");
      if (signal.aborted) return Promise.resolve("held");
      return new Promise<PhoneHoldWait>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (outcome: PhoneHoldWait) => {
          waiting.delete(settle);
          if (timer) clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(outcome);
        };
        const onAbort = () => settle("held");
        waiting.add(settle);
        timer = setTimeout(() => settle("held"), maxMs);
        timer.unref?.();
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    stop() {
      clock.stop();
      held = false;
      settleWaits("handed-back");
    },
  };
}
