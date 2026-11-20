// @vitest-environment happy-dom
// The live desktop's own lifecycle, with the connection played by the test.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Events = { connected(): void; disconnected(): void };
const fixture = vi.hoisted(() => ({
  attempts: [] as Array<{ target: string; events: Events; client: { focus: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; sendKey: ReturnType<typeof vi.fn> } }>,
  refuse: false,
}));
vi.mock("@/lib/desktop-connection", async (importOriginal) => ({
  // Only the transport is played: the key mapping and the text encoder are the real ones, so the
  // assertions read the keysyms that would reach the VNC server.
  ...await importOriginal<typeof import("@/lib/desktop-connection")>(),
  connectDesktop: async (_screen: HTMLElement, target: string, options: { events: Events }) => {
    if (fixture.refuse) throw new Error("unreachable");
    const client = { focus: vi.fn(), disconnect: vi.fn(), sendKey: vi.fn() };
    fixture.attempts.push({ target, events: options.events, client });
    return client;
  },
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: undefined, dragProps: {}, noDragStyle: undefined }),
  useDesktopCapabilities: () => ({ ready: true, capabilities: { windowChrome: "native" } }),
}));

const { LiveDesktop } = await import("./LiveDesktop");
let root: Root;
let props: Parameters<typeof LiveDesktop>[0];
const draw = (patch: Partial<typeof props> = {}) => {
  props = { ...props, ...patch };
  flushSync(() => root.render(createElement(LiveDesktop, props)));
};
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const state = () => document.querySelector<HTMLElement>("[data-live-desktop]")?.dataset.state;
const button = (label: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label);

beforeEach(async () => {
  fixture.attempts = [];
  fixture.refuse = false;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    target: "local/shared", threadId: "thread", name: "Scout", poster: null, expanded: false,
    onExpandedChange: vi.fn(), onHandBack: vi.fn(), handingBack: false, onUnreachable: vi.fn(),
  };
  draw();
  await settle();
});
afterEach(() => {
  root.unmount();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the live desktop", () => {
  it("takes the keyboard once the desktop answers", () => {
    expect(state()).toBe("connecting");
    flushSync(() => fixture.attempts[0]!.events.connected());
    expect(state()).toBe("connected");
    expect(fixture.attempts[0]!.client.focus).toHaveBeenCalled();
  });

  it("a desktop that never answers is reported, so the computer goes back to the bot", () => {
    flushSync(() => fixture.attempts[0]!.events.disconnected());
    expect(props.onUnreachable).toHaveBeenCalledTimes(1);
  });

  it("a connection the server refuses is reported the same way", async () => {
    root.unmount();
    fixture.refuse = true;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    draw({ onUnreachable: vi.fn() });
    await settle();
    expect(props.onUnreachable).toHaveBeenCalledTimes(1);
  });

  it("a drop mid-session reconnects once by itself, then offers Reconnect", async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    flushSync(() => fixture.attempts[0]!.events.connected());
    flushSync(() => fixture.attempts[0]!.events.disconnected());
    expect(state()).toBe("disconnected");
    expect(props.onUnreachable).not.toHaveBeenCalled();
    await wait(1_200);
    expect(fixture.attempts).toHaveLength(2);
    expect(fixture.attempts[0]!.client.disconnect).toHaveBeenCalled();
    flushSync(() => fixture.attempts[1]!.events.disconnected());
    await wait(1_500);
    expect(fixture.attempts, "no endless reconnect loop").toHaveLength(2);
    flushSync(() => button("Reconnect")!.click());
    await settle();
    expect(fixture.attempts).toHaveLength(3);
  });

  it("closes its connection when it goes away", () => {
    const client = fixture.attempts[0]!.client;
    root.unmount();
    expect(client.disconnect).toHaveBeenCalled();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  it("full screen keeps the same connection and offers Exit and Hand back", async () => {
    flushSync(() => fixture.attempts[0]!.events.connected());
    draw({ expanded: true });
    await settle();
    expect(fixture.attempts, "growing the view must not reconnect").toHaveLength(1);
    flushSync(() => button("Exit fullscreen")!.click());
    expect(props.onExpandedChange).toHaveBeenCalledWith(false);
    flushSync(() => button("Hand control back")!.click());
    expect(props.onHandBack).toHaveBeenCalledTimes(1);
  });

  it("raises the tablet's keyboard from its button, and sends what it types", async () => {
    flushSync(() => fixture.attempts[0]!.events.connected());
    draw({ expanded: true });
    await settle();
    const keyboard = button("Keyboard")!;
    expect(keyboard.getAttribute("aria-pressed")).toBe("false");
    flushSync(() => keyboard.click());
    expect(keyboard.getAttribute("aria-pressed"), "the keyboard is up").toBe("true");
    const field = document.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(document.activeElement, "the soft keyboard types into the field").toBe(field);
    // A phone keyboard with no physical key behind it sends keydown for each character it inserts.
    const sent = () => (fixture.attempts[0]!.client.sendKey.mock.calls as Array<[number, string | null, boolean?]>);
    const keysyms = () => sent().filter(([, , down]) => down !== false).map(([keysym]) => keysym);
    flushSync(() => {
      for (const key of ["l", "s"]) field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    // The printable keys carry their code point, which is what X reads for a Latin letter.
    expect(keysyms()).toEqual(["l".codePointAt(0), "s".codePointAt(0)]);
    flushSync(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    // Enter is not a character, so it goes by keysym.
    expect(keysyms().at(-1)).toBe(0xff0d);
  });

  it("a tap on the desktop raises the keyboard; a drag leaves it down", async () => {
    flushSync(() => fixture.attempts[0]!.events.connected());
    const desktop = document.querySelector<HTMLElement>("[role='application']")!;
    // A drag moves the pixels, not the person's caret, so it must not pop a keyboard over them.
    flushSync(() => {
      desktop.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
      desktop.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", clientX: 90, clientY: 90, bubbles: true }));
    });
    expect(button("Keyboard")!.getAttribute("aria-pressed")).toBe("false");
    flushSync(() => {
      desktop.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", clientX: 30, clientY: 30, bubbles: true }));
      desktop.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", clientX: 32, clientY: 31, bubbles: true }));
    });
    expect(button("Keyboard")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("Backspace deletes on the desktop, not in the invisible field", async () => {
    flushSync(() => fixture.attempts[0]!.events.connected());
    draw({ expanded: true });
    await settle();
    flushSync(() => button("Keyboard")!.click());
    const field = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const sent = () => (fixture.attempts[0]!.client.sendKey.mock.calls as Array<[number, string | null, boolean?]>);
    flushSync(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    // One character, then a Backspace pressed and released: the desktop sees both in order.
    expect(sent().map(([keysym, , down]) => (down === undefined ? keysym : down ? keysym : "up")))
      .toEqual(["a".codePointAt(0), 0xff08, "up"]);
  });
});
