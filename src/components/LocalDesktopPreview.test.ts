// @vitest-environment happy-dom
// The phone's own desktop: one silent retry when the first connection is too slow to hold.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  connect: vi.fn(),
  clients: [] as Array<{ disconnect: () => void }>,
}));
vi.mock("@/lib/desktop-connection", () => ({
  connectDesktop: fixture.connect,
  typeOnDesktop: vi.fn(),
}));

const { LocalDesktopPreview } = await import("./LocalDesktopPreview");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const eventsOf = (call: number) => (fixture.connect.mock.calls[call]![2] as { events: Record<string, () => void> }).events;

beforeEach(() => {
  fixture.connect.mockReset();
  fixture.clients.length = 0;
  fixture.connect.mockImplementation(async () => {
    const client = { disconnect: vi.fn(), scaleViewport: false, background: "" };
    fixture.clients.push(client as never);
    return client as never;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("retries the connection once when the first one is too slow to hold", async () => {
  vi.useFakeTimers();
  await act(async () => root.render(createElement(LocalDesktopPreview, { target: "local/shared", name: "SpokyBot" })));
  expect(fixture.connect).toHaveBeenCalledTimes(1);

  await act(async () => { eventsOf(0).disconnected(); });
  expect(host.querySelector("[data-local-desktop]")?.getAttribute("data-state")).toBe("disconnected");
  expect(fixture.connect).toHaveBeenCalledTimes(1);

  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(fixture.connect).toHaveBeenCalledTimes(2);

  // A retry that fails again does not become a loop: the reconnect button stays the way to try.
  await act(async () => { eventsOf(1).disconnected(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(fixture.connect).toHaveBeenCalledTimes(2);
});

it("never retries a connection that came up", async () => {
  vi.useFakeTimers();
  await act(async () => root.render(createElement(LocalDesktopPreview, { target: "local/shared", name: "SpokyBot" })));
  await act(async () => { eventsOf(0).connected(); });
  expect(host.querySelector("[data-local-desktop]")?.getAttribute("data-state")).toBe("connected");
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(fixture.connect).toHaveBeenCalledTimes(1);
});