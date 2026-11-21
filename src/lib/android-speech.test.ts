// @vitest-environment happy-dom
// The phone's recognizer has to speak the same protocol the desktop's speech helper does, or the
// composer's microphone works nowhere: `available` decides whether the button is drawn at all.
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = {
  capabilitiesJson: () => JSON.stringify({}),
  speechStart: vi.fn(() => true),
  speechStop: vi.fn(),
};

beforeEach(() => {
  vi.resetModules();
  bridge.speechStart.mockClear();
  bridge.speechStop.mockClear();
  const host = window as unknown as Record<string, unknown>;
  delete host.ogb;
  delete host.ombSpeech;
  delete host.ombSpeechEnd;
  delete host.ombAndroidCaps;
});

describe("dictation on the phone", () => {
  it("installs the same two calls and two subscriptions the desktop app exposes", async () => {
    (window as unknown as Record<string, unknown>).ombAndroidCaps = bridge;
    const { installAndroidSpeech } = await import("./android-speech.ts");
    installAndroidSpeech();
    const ogb = window.ogb as unknown as Record<string, unknown>;
    expect(typeof ogb.speechStart).toBe("function");
    expect(typeof ogb.speechStop).toBe("function");
    expect(typeof ogb.onSpeechTranscript).toBe("function");
    expect(typeof ogb.onSpeechEnd).toBe("function");
  });

  it("starts and stops the native recognizer", async () => {
    (window as unknown as Record<string, unknown>).ombAndroidCaps = bridge;
    const { installAndroidSpeech } = await import("./android-speech.ts");
    installAndroidSpeech();
    await window.ogb!.speechStart();
    await window.ogb!.speechStop();
    expect(bridge.speechStart).toHaveBeenCalledTimes(1);
    expect(bridge.speechStop).toHaveBeenCalledTimes(1);
  });

  it("delivers what the shell emits, partial then final", async () => {
    (window as unknown as Record<string, unknown>).ombAndroidCaps = bridge;
    const { installAndroidSpeech } = await import("./android-speech.ts");
    installAndroidSpeech();
    const lines: Array<{ partial?: boolean; text?: string }> = [];
    window.ogb!.onSpeechTranscript((line) => lines.push(line));

    const receive = (window as unknown as { ombSpeech: (partial: boolean, text: string) => void }).ombSpeech;
    receive(true, "hola");
    receive(false, "hola mundo");
    expect(lines).toEqual([{ partial: true, text: "hola" }, { partial: false, text: "hola mundo" }]);
  });

  it("reports a refused microphone so the composer can say why", async () => {
    (window as unknown as Record<string, unknown>).ombAndroidCaps = bridge;
    const { installAndroidSpeech } = await import("./android-speech.ts");
    installAndroidSpeech();
    const ends: Array<{ code: number | null; reason?: string }> = [];
    window.ogb!.onSpeechEnd((info) => ends.push(info));

    const end = (window as unknown as { ombSpeechEnd: (code: number, reason: string | null) => void }).ombSpeechEnd;
    end(1, "speech-not-authorized");
    expect(ends).toEqual([{ code: 1, reason: "speech-not-authorized" }]);
  });

  it("does nothing on a build whose shell has no recognizer", async () => {
    (window as unknown as Record<string, unknown>).ombAndroidCaps = { capabilitiesJson: () => "{}" };
    const { installAndroidSpeech } = await import("./android-speech.ts");
    installAndroidSpeech();
    expect(window.ogb).toBeUndefined();
  });

  it("forwards each stop, so a second tap also reaches the shell", async () => {
    (window as unknown as Record<string, unknown>).ombAndroidCaps = bridge;
    const { installAndroidSpeech } = await import("./android-speech.ts");
    installAndroidSpeech();
    await window.ogb!.speechStop();
    await window.ogb!.speechStop();
    expect(bridge.speechStop).toHaveBeenCalledTimes(2);
  });
});
