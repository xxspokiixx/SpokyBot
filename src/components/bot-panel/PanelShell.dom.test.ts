// @vitest-environment happy-dom
// The Simple bot panel in a real DOM, where effects run and focus moves: named links, Escape and focus.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, BotSettingsSection } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch, flushBotPatches: () => Promise.resolve(null) }),
  };
});
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, readAdvancedMode: () => false, setAdvancedMode: vi.fn() }));
vi.mock("../DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("../DesktopCapabilities")>(),
  useCaptionChrome: () => ({ dragProps: {}, padClass: "" }),
}));
vi.mock("../Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("../AvatarImageGenerator", () => ({ AvatarImageGenerator: () => null }));
vi.mock("@/lib/use-organization-branding", () => ({ useOrganizationBranding: () => null }));
vi.mock("../bot-settings/MemorySection", () => ({ MemorySection: () => null }));
vi.mock("../bot-settings/useBotOverview", () => ({
  useBotOverview: () => ({ overview: null, overviewError: false, prompt: null, promptError: false }),
  useBotHistory: () => ({ rows: null, error: false, revision: null, rollingBack: false }),
  HistoryRollbackDialog: () => null,
}));
const stub = (name: string) => () => createElement("div", { [`data-stub-${name}`]: true });
vi.mock("./DetailsTab", () => ({ DetailsTab: stub("details") }));
vi.mock("./LibraryTab", () => ({ LibraryTab: stub("library") }));
vi.mock("./ComputerTab", () => ({ ComputerTab: stub("computer") }));
vi.mock("./SettingsTab", () => ({ SettingsTab: stub("settings") }));
vi.mock("./pages", () => ({ PageBody: ({ page }: { page: string }) => createElement("div", { "data-stub-page": page }), pageSurfaceCls: "" }));

const { BotPanel } = await import("./PanelShell");
const { openBotSettings } = await import("./panel-link");

const bot: Bot = {
  id: "scout", threadId: "thread-scout", name: "Scout", title: "Researcher", description: "", soul: "",
  notifications: true, color: "green", unread: false, messages: [],
  modelSelection: { instanceId: "claude", model: "claude-opus-5-5" },
};
const onClose = vi.fn();
const derived = { activeState: "idle", patch: vi.fn() } as never;

let host: HTMLDivElement;
let root: Root;
const render = (linkedSection: BotSettingsSection | null) =>
  flushSync(() => root.render(createElement(BotPanel, { bot, derived, linkedSection, onClose })));
// Passive effects and the renders they schedule.
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const tab = () => host.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-panel-tab") ?? null;
const page = () => host.querySelector("[data-panel-page-view]")?.getAttribute("data-panel-page-view") ?? null;
const click = (element: Element | null) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
};

beforeEach(() => {
  fixture.dispatch.mockReset();
  onClose.mockReset();
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  // A link without a page lands where its section does, so no test sees another's page.
  openBotSettings(vi.fn(), "overview");
});

describe("named links into the bot panel", () => {
  it("opens on the page a link names, and moves there when a link arrives while it is open", async () => {
    openBotSettings(fixture.dispatch, "access", { page: "apps" });
    render("access");
    await settle();
    expect(page()).toBe("apps");

    flushSync(() => openBotSettings(fixture.dispatch, "access", { page: "mcp" }));
    await settle();
    expect(page()).toBe("mcp");

    flushSync(() => openBotSettings(fixture.dispatch, "access"));
    await settle();
    expect([tab(), page()]).toEqual(["computer", null]);
  });

  it("follows the same link again after the panel has moved on", async () => {
    openBotSettings(fixture.dispatch, "usage");
    render("usage");
    await settle();
    expect(tab()).toBe("settings");

    click(host.querySelector('[data-panel-tab="details"]'));
    expect(tab()).toBe("details");

    flushSync(() => openBotSettings(fixture.dispatch, "usage"));
    render("usage");
    await settle();
    expect(tab()).toBe("settings");
  });
});
