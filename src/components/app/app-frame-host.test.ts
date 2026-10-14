// @vitest-environment happy-dom
// The desktop frame host: the iframe is exactly what security rule 1 says,
// its srcdoc is the document's own, the shared router answers only this
// frame's window, and engagement needs focus to enter the frame while the
// pointer is over it (or by Tab). happy-dom runs no script in the frame, so
// the View's side is played by message events whose source is its window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APP_SAMPLES } from "../../../shared/app-samples";
import { botHtmlDocument } from "../../../shared/app-frame/document";
import { APP_FRAME_SANDBOX, createAppIframe, mountAppFrame, trackAppEngagement, type AppFrameAdapter } from "./app-frame-host";

const doc = botHtmlDocument({ messageId: "m1", rev: 0, html: APP_SAMPLES.counter!.html, approval: "confirm" });

function adapter(): AppFrameAdapter & { [key: string]: ReturnType<typeof vi.fn> } {
  return {
    callRpc: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => {}),
    openLink: vi.fn(async () => {}),
    setContext: vi.fn(async () => {}),
    resize: vi.fn(),
    teardownRequested: vi.fn(),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

describe("the frame element", () => {
  it("is sandboxed with exactly allow-scripts allow-forms and has no allow attribute", () => {
    const iframe = createAppIframe(document, "Coffee counter", 200, "dark");
    expect(APP_FRAME_SANDBOX).toBe("allow-scripts allow-forms");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(iframe.hasAttribute("allow")).toBe(false);
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.getAttribute("title")).toBe("Coffee counter");
    expect(iframe.style.height).toBe("200px");
    expect(iframe.style.colorScheme).toBe("dark");
    for (const token of ["allow-same-origin", "allow-popups", "allow-top-navigation", "allow-modals"]) {
      expect(iframe.getAttribute("sandbox")).not.toContain(token);
    }
  });

  it("gets the document's srcdoc verbatim, and only after the router listens", () => {
    const listening = vi.spyOn(window, "addEventListener");
    const host = mountAppFrame({ container, doc, title: "Coffee counter", height: 200, hostContext: { theme: "light" }, hostVersion: "test", adapter: adapter() });
    const iframe = container.querySelector("iframe")!;
    expect(iframe).toBe(host.iframe);
    expect(iframe.getAttribute("srcdoc")).toBe(doc.srcdoc);
    expect(iframe.srcdoc.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="')).toBe(true);
    expect(listening).toHaveBeenCalledWith("message", expect.any(Function));
    host.destroy();
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("the bridge on the desktop", () => {
  it("answers ui/initialize from the frame's own window, and nothing from any other", () => {
    const host = mountAppFrame({ container, doc, title: "Coffee counter", height: 200, hostContext: { theme: "dark" }, hostVersion: "9.9.9", adapter: adapter() });
    const view = host.iframe.contentWindow!;
    const posted = vi.spyOn(view, "postMessage");
    const request = { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appInfo: { name: "x", version: "1" }, appCapabilities: {} } };
    // another window: dropped without an answer (rule 9)
    window.dispatchEvent(new MessageEvent("message", { data: request, source: window }));
    expect(posted).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { data: request, source: view as unknown as MessageEventSource }));
    expect(posted).toHaveBeenCalledTimes(1);
    const [answer, target] = posted.mock.calls[0]! as [any, string];
    expect(target).toBe("*");
    expect(answer).toMatchObject({ jsonrpc: "2.0", id: 1, result: { hostInfo: { name: "mausbot", version: "9.9.9" }, hostContext: { theme: "dark" } } });
    // a bot's page has no server tools
    expect(answer.result.hostCapabilities.serverTools).toBeUndefined();
    expect(answer.result.hostCapabilities.sandbox).toEqual({ permissions: {}, csp: { connectDomains: doc.network.connect, resourceDomains: doc.network.resources } });
    host.destroy();
  });

  it("sizes the frame from size-changed, and asks the View before tearing down", async () => {
    const calls = adapter();
    const host = mountAppFrame({ container, doc, title: "Coffee counter", height: 200, hostContext: { containerDimensions: { width: 600, maxHeight: 500 } }, hostVersion: "1", adapter: calls });
    const view = host.iframe.contentWindow!;
    const posted = vi.spyOn(view, "postMessage");
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: view as unknown as MessageEventSource }));
    send({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 9000 } });
    expect(calls.resize).toHaveBeenLastCalledWith(500);
    expect(host.iframe.style.height).toBe("500px");
    const done = host.teardown();
    const request = posted.mock.calls.map(([message]) => message as any).find((message) => message.method === "ui/resource-teardown");
    expect(request).toBeTruthy();
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    await done;
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("engagement", () => {
  function setup() {
    const iframe = createAppIframe(document, "App", 100);
    container.appendChild(iframe);
    const engagement = trackAppEngagement(iframe);
    return { iframe, engagement };
  }

  it("is off until focus enters the frame while the pointer is over it", async () => {
    const { iframe, engagement } = setup();
    expect(engagement.engaged()).toBe(false);
    // focus moves into the frame with the pointer elsewhere: not engaged
    iframe.focus();
    window.dispatchEvent(new Event("blur"));
    await tick();
    expect(document.activeElement).toBe(iframe);
    expect(engagement.engaged()).toBe(false);
    // the pointer over it, focus entering again: engaged
    window.dispatchEvent(new Event("focus"));
    iframe.dispatchEvent(new Event("pointerenter"));
    window.dispatchEvent(new Event("blur"));
    await tick();
    expect(engagement.engaged()).toBe(true);
    // focus back in the app: not any more
    window.dispatchEvent(new Event("focus"));
    expect(engagement.engaged()).toBe(false);
    engagement.dispose();
  });

  it("counts focus that entered by Tab, and ends when focus leaves the frame", async () => {
    const { iframe, engagement } = setup();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    iframe.focus();
    iframe.dispatchEvent(new Event("focus"));
    await tick();
    expect(engagement.engaged()).toBe(true);
    const other = document.createElement("button");
    container.appendChild(other);
    other.focus();
    expect(engagement.engaged()).toBe(false);
    engagement.dispose();
  });

  it("counts focus that entered where the pointer was last seen at the frame's edge (a frame in its own process)", async () => {
    const { iframe, engagement } = setup();
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, right: 700, bottom: 400, width: 600, height: 200, x: 100, y: 200, toJSON() {} } as DOMRect);
    const move = (x: number, y: number) => document.dispatchEvent(Object.assign(new Event("pointermove", { bubbles: true }), { clientX: x, clientY: y }));
    // last seen far above the frame: focus entering it is not the person's
    move(300, 20);
    iframe.focus();
    window.dispatchEvent(new Event("blur"));
    await tick();
    expect(engagement.engaged()).toBe(false);
    // last seen at its top edge, on the way in: it is
    window.dispatchEvent(new Event("focus"));
    move(300, 198);
    window.dispatchEvent(new Event("blur"));
    await tick();
    expect(engagement.engaged()).toBe(true);
    // the pointer left the window since: not any more
    window.dispatchEvent(new Event("focus"));
    document.documentElement.dispatchEvent(new Event("mouseleave"));
    window.dispatchEvent(new Event("blur"));
    await tick();
    expect(engagement.engaged()).toBe(false);
    engagement.dispose();
  });

  it("a frame that takes focus by itself while the pointer is away is not engaged", async () => {
    const { iframe, engagement } = setup();
    iframe.dispatchEvent(new Event("pointerenter"));
    iframe.dispatchEvent(new Event("pointerleave"));
    iframe.focus();
    iframe.dispatchEvent(new Event("focus"));
    await tick();
    expect(engagement.engaged()).toBe(false);
    engagement.dispose();
  });
});
