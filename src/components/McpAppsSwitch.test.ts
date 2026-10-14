// @vitest-environment happy-dom
// "Show its apps in chat" in Settings → MCP servers: hidden until the
// server's listing reports `apps`, and a press saves the other value on the
// route every other server change uses.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpAppsSwitch } from "./McpAppsSwitch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const draw = (server: { name: string; apps?: boolean }, onSaved = vi.fn()) => {
  act(() => root.render(createElement(McpAppsSwitch<{ name: string; apps?: boolean }>, { server, disabled: false, onSaved })));
  return onSaved;
};

describe("the apps switch", () => {
  it("is hidden for a server whose listing does not say", () => {
    draw({ name: "excalidraw" });
    expect(host.innerHTML).toBe("");
  });

  it("shows the server's value and saves the other one", async () => {
    const saved = [{ name: "excalidraw", apps: false }];
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ servers: saved }), { status: 200, headers: { "content-type": "application/json" } }));
    const onSaved = draw({ name: "excalidraw", apps: true });
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(host.textContent).toContain("Show its apps in chat");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Show apps from excalidraw in chat");
    await act(async () => { toggle.click(); });
    expect(fetchMock).toHaveBeenCalledWith("/api/mcp/servers/excalidraw", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ apps: false }) }));
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("says what went wrong in place", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "no such server" }), { status: 404, headers: { "content-type": "application/json" } }));
    const onSaved = draw({ name: "gone", apps: false });
    await act(async () => { host.querySelector<HTMLButtonElement>('[role="switch"]')!.click(); });
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("no such server");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
