// @vitest-environment happy-dom
// The Simple composer's + menu picks the call mode away from the call button; the button starts the call exactly as
// its own call-mode menu would.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: {
        ...original.initialState,
        config: {
          tts: { configured: true, ready: true, voice: "v" },
          live: { configured: true, voice: "marin", readTypedReplies: true, idleMinutes: 5 },
        } as AppState["config"],
      },
      dispatch: vi.fn(),
    }),
  };
});
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: true, engine: "apple-speech", onDevice: true } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { CallTargetButton } = await import("./CallView");
const { requestCallStart } = await import("@/lib/call-start-request");
const { callMode, setCallMode } = await import("@/lib/call-mode");
const { currentCall, endCall, startCall } = await import("@/lib/call");
const { configureLiveMedia, liveMedia, resetLiveMedia } = await import("@/lib/live-call-media");

let root: Root;
let container: HTMLDivElement;
const onStart = vi.fn();

beforeEach(() => {
  window.ogb = { speechStart: vi.fn(), speechStop: vi.fn(async () => {}) } as unknown as NonNullable<Window["ogb"]>;
  configureLiveMedia({ getUserMedia: () => new Promise<MediaStream>(() => {}) });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(CallTargetButton, {
    targetId: "atlas", targetName: "Atlas", threadId: "thread-atlas", voices: ["v"],
    requireExplicitVoices: false, liveCapable: true, placement: "composer", fill: "#8057C8", onStart,
  })));
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  setCallMode("turns");
  resetLiveMedia();
  endCall();
  onStart.mockClear();
  delete window.ogb;
});

describe("a call started from the composer's + menu", () => {
  it("takes turns with this bot, and remembers the mode", () => {
    setCallMode("live");
    flushSync(() => requestCallStart("atlas", "turns"));
    expect(currentCall()).toBe("atlas");
    expect(liveMedia().phase).toBe("idle");
    expect(onStart).toHaveBeenCalledWith("turns");
    expect(callMode()).toBe("turns");
  });

  it("goes Live through the Live media", () => {
    flushSync(() => requestCallStart("atlas", "live"));
    expect(liveMedia()).toMatchObject({ phase: "starting", botId: "atlas", threadId: "thread-atlas" });
    expect(onStart).toHaveBeenCalledWith("live");
    expect(callMode()).toBe("live");
  });

  it("is ignored for another bot, and while this one is already on a call", () => {
    flushSync(() => requestCallStart("juniper", "turns"));
    expect(currentCall()).toBeNull();
    flushSync(() => startCall("atlas"));
    flushSync(() => requestCallStart("atlas", "live"));
    expect(liveMedia().phase).toBe("idle");
    expect(onStart).not.toHaveBeenCalled();
  });
});
