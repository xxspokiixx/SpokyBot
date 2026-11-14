// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: undefined }),
  useDesktopCapabilities: () => ({
    ready: true,
    capabilities: {
      host: { platform: "android", label: "Android", session: "headless", packaged: true },
      windowChrome: "native",
      screenPreview: { available: false, interaction: "none", reasonCode: "headless-environment" },
      dictation: { available: false, engine: "none", onDevice: false },
      localComputer: { available: true, support: "supported", enabled: true, status: "ready" },
    },
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./CloudScreenPreview", () => ({ CloudScreenPreview: () => null }));
vi.mock("./AndroidDevicePanel", async (importOriginal) => ({
  ...await importOriginal<typeof import("./AndroidDevicePanel")>(),
  AndroidDevicePanel: () => null,
}));
vi.mock("./BrowserPanel", () => ({ BrowserPanel: () => null }));
vi.mock("./CloudBackendPicker", () => ({ CloudBackendPicker: () => null }));
vi.mock("./bot-settings/RoutinesSection", () => ({ RoutinesSection: () => null }));
vi.mock("./data/DataPanel", () => ({ DataPanel: () => null }));
vi.mock("./LocalDesktopPreview", () => ({
  LocalDesktopPreview: ({ target, name }: { target: string; name: string }) =>
    createElement("div", { "data-testid": "local-desktop-preview", "data-target": target }, name),
}));

const apiCalls: Array<{ path: string; method?: string }> = [];
let nextStartResult: Record<string, unknown> | Error = {};
let statusResult: Record<string, unknown> = {};

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: async (path: string, init?: RequestInit) => {
    apiCalls.push({ path, method: init?.method });
    if (path.startsWith("/api/bots/spoky/computer/control")) return { held: false, helpReason: null };
    if (path === "/api/local-computer") return statusResult;
    if (path === "/api/local-computer/start") {
      if (nextStartResult instanceof Error) throw nextStartResult;
      return nextStartResult;
    }
    return {};
  },
}));

const { ComputerPanel } = await import("./ComputerPanel");
const { BotEditorStore, initialState } = await import("@/state/store");

const engine = (instanceId: string) => ({
  instanceId,
  driverKind: "claudeAgent",
  displayName: instanceId,
  access: "subscription",
  snapshot: { state: "available", version: "1", authenticated: true },
  models: { default: "m", options: [{ id: "m", label: "M" }] },
  capabilities: { computerMcp: true, browserMcp: true },
}) as InstanceInfo;

const makeBot = (): Bot => ({
  id: "spoky",
  threadId: "thread",
  name: "SpokyBot",
  title: "",
  description: "",
  color: "chrome",
  notifications: true,
  unread: false,
  busy: false,
  computer: "local",
  messages: [],
  modelSelection: { instanceId: "claude", model: "m" },
  tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask" }],
}) as unknown as Bot;

let root: Root | null = null;
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function renderPanel() {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const value: Parameters<typeof BotEditorStore>[0]["value"] = {
    state: { ...initialState, instances: [engine("claude")], config: { box: { configured: true } } as AppState["config"] } as AppState,
    dispatch: vi.fn(),
    flushBotPatches: async () => null,
    refreshInstances: async () => {},
    refreshModels: async () => {},
  };
  flushSync(() => root!.render(createElement(BotEditorStore, { value, children: createElement(ComputerPanel, { bot: makeBot() }) })));
}

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  apiCalls.length = 0;
});

describe("ComputerPanel on Android", () => {
  it("auto-starts the proot desktop when not running and hides LinuxLocalControl", async () => {
    statusResult = {
      mode: "shared",
      max_instances: 2,
      image: false,
      create_supported: true,
      container: "missing",
      imageMatches: false,
      managed: false,
      network: "loopback",
      security: "hardened",
      persistence: "durable",
      desktopReady: false,
      ready: false,
      problem: "Graphical desktop not set up.",
      viewer_url: "",
      target_key: "shared",
    };
    nextStartResult = {
      ...statusResult,
      image: true,
      imageMatches: true,
      managed: true,
      container: "running",
      desktopReady: true,
      ready: true,
      problem: null,
      viewer_url: "http://localhost:56082/vnc.html",
    };

    renderPanel();
    await act(async () => { await settle(); });

    expect(apiCalls.some((c) => c.path === "/api/local-computer/start" && c.method === "POST")).toBe(true);
    expect(document.querySelector('[data-testid="local-desktop-preview"]')?.textContent).toBe("SpokyBot");
    expect(document.body.textContent).not.toContain("Ubuntu 24.04 GNOME");
  });

  it("offers a retry button when auto-start fails", async () => {
    statusResult = {
      mode: "shared",
      max_instances: 2,
      image: true,
      create_supported: true,
      container: "missing",
      imageMatches: true,
      managed: true,
      network: "loopback",
      security: "hardened",
      persistence: "durable",
      desktopReady: false,
      ready: false,
      problem: "Graphical desktop not running",
      viewer_url: "",
      target_key: "shared",
    };
    nextStartResult = new Error("X server failed to bind");

    renderPanel();
    await act(async () => { await settle(); });

    expect(document.body.textContent).toContain("X server failed to bind");
    expect(document.body.textContent).toContain("Try again");
  });
});
