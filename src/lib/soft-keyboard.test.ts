// @vitest-environment happy-dom
// What a soft keyboard's keys become on the wire, without a server.
import { describe, expect, it, vi } from "vitest";

import { sendSoftKey, typeOnDesktop } from "./desktop-connection.ts";

function client() {
  const sendKey = vi.fn();
  return { sendKey } as unknown as Parameters<typeof sendSoftKey>[0] & { sendKey: typeof sendKey };
}

const sent = (fake: ReturnType<typeof client>) =>
  (fake.sendKey.mock.calls as Array<[number, string | null, boolean?]>);

describe("the tablet's keys on the remote desktop", () => {
  it("sends a named key as its X keysym, pressed and released", () => {
    const fake = client();
    expect(sendSoftKey(fake, { key: "Enter" })).toBe(true);
    expect(sent(fake)).toEqual([[0xff0d, "Enter", true], [0xff0d, "Enter", false]]);
  });

  it("knows the keys a phone offers that are not characters", () => {
    const cases: Array<[string, number]> = [
      ["Backspace", 0xff08],
      ["Tab", 0xff09],
      ["Escape", 0xff1b],
      ["ArrowLeft", 0xff51],
      ["ArrowUp", 0xff52],
      ["ArrowRight", 0xff53],
      ["ArrowDown", 0xff54],
      ["Delete", 0xffff],
      ["Home", 0xff50],
      ["End", 0xff57],
    ];
    for (const [key, keysym] of cases) {
      const fake = client();
      expect(sendSoftKey(fake, { key }), key).toBe(true);
      expect(sent(fake)[0]![0], key).toBe(keysym);
    }
  });

  it("leaves a chord to a physical keyboard, which alone can hold the modifier", () => {
    for (const key of ["c", "Enter", "ArrowDown"]) {
      const fake = client();
      expect(sendSoftKey(fake, { key, ctrlKey: true }), key).toBe(false);
      expect(fake.sendKey).not.toHaveBeenCalled();
    }
  });

  it("reports a plain character as not its own, so the text path sends it once", () => {
    const fake = client();
    expect(sendSoftKey(fake, { key: "a" })).toBe(false);
    expect(fake.sendKey).not.toHaveBeenCalled();
  });

  it("encodes text by code point, and a character X has no keysym for as Unicode", () => {
    const fake = client();
    typeOnDesktop(fake as never, "añ\n");
    // ñ is U+00F1 and X has a keysym for it, so it goes as-is; 日 does not, and travels as Unicode.
    expect(sent(fake).map(([keysym]) => keysym)).toEqual(["a".codePointAt(0), 0xf1, 0xff0d]);
    const beyond = client();
    typeOnDesktop(beyond as never, "日");
    expect(sent(beyond)[0]![0]).toBe(0x01000000 | "日".codePointAt(0)!);
  });
});
