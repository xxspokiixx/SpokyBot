// @vitest-environment happy-dom
// When MausBot's first-launch card may open: after the welcome, which no longer hands over to an app tour.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING, LOCAL_VIEWER, WELCOME_VERSION } from "@/lib/onboarding";
import { setLocale } from "@/lib/i18n";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, welcoming: vi.fn() }));
vi.mock("@/state/store", async (original) => ({ ...(await original<typeof import("@/state/store")>()), useStore: () => ({ state: f.state, dispatch: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ emailGateDone: () => false, track: vi.fn() }));
vi.mock("@/lib/default-bot", async (original) => ({
  ...(await original<typeof import("@/lib/default-bot")>()),
  useViewerEmail: () => null,
  myDefaultBot: (bots: unknown[]) => bots[0],
  setWelcomingBot: (id: string | null) => f.welcoming(id),
}));
vi.mock("./MausBotCustomize", () => ({ MausBotCustomize: () => null }));
const { MausBotWelcome } = await import("./MausBotWelcome");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const maus = { id: "maus", threadId: "t1", name: "MausBot", title: "", description: "", notifications: true, color: "chrome", mascotBody: null,
  avatarUrl: null, unread: false, modelSelection: { instanceId: "claude", model: "sonnet" }, createdAt: 1, defaultBot: {}, messages: [] };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  setLocale("en");
  f.welcoming.mockReset();
  vi.stubGlobal("ogb", undefined);
  const welcomed = { ...EMPTY_ONBOARDING, completedAt: "2026-10-23T00:00:00.000Z", version: WELCOME_VERSION };
  f.state = { config: { onboarding: welcomed }, bots: [maus], welcomeOpen: false, tourOpen: false, instances: [], groups: [] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("opens once the welcome is done, though the app tour was never taken (it only starts from Settings now)", async () => {
  await act(async () => { root.render(createElement(MausBotWelcome, { viewer: LOCAL_VIEWER })); });
  expect(f.welcoming).toHaveBeenCalledWith("maus");
});

it("waits while the app tour runs from Settings", async () => {
  f.state = { ...f.state, tourOpen: true };
  await act(async () => { root.render(createElement(MausBotWelcome, { viewer: LOCAL_VIEWER })); });
  expect(f.welcoming).not.toHaveBeenCalledWith("maus");
});
