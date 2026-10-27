// @vitest-environment happy-dom
// MausBot's first messages, without asking an AI: who it is, what it found looking around, and chips for only what is
// still missing.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setWelcomingBot, stageIntro } from "@/lib/default-bot";
import { setLocale, t } from "@/lib/i18n";
import type { Bot, InstanceInfo, Message } from "@/state/store";

const f = vi.hoisted(() => ({
  state: {} as Record<string, unknown>, dispatch: vi.fn(), advanced: false, local: false,
  services: {} as Record<string, { connected: boolean }>, phones: [] as unknown[], found: null as unknown, detect: vi.fn(),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: async () => ({ phones: f.phones }) }));
vi.mock("./PluginsPanel", () => ({ preloadConnectedApps: async () => ({ services: f.services, authoritative: true }) }));
vi.mock("./bot-settings/useBotApps", () => ({ loadAppCards: async () => new Map([["gmail", { label: "Gmail" }], ["github", { label: "GitHub" }]]) }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
vi.mock("./mascot-clock", () => ({ usePrefersReducedMotion: () => false }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => f.advanced }));
vi.mock("@/lib/setup-import", () => ({
  localSetupImport: () => f.local,
  setupImportApi: {},
  detectSetupWithin: () => { f.detect(); return { found: Promise.resolve(f.found), cancel: () => {} }; },
}));
const { ARRIVAL_MS, HelperIntro, introLines, lookAroundReport } = await import("./HelperIntro");
const { setupAction } = await import("./HelperSetup");
const { SIMPLE_BOT_BUBBLE } = await import("./chat-bubble");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const claude = (ready: boolean): InstanceInfo => ({ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude",
  snapshot: { state: ready ? "available" : "unavailable", authenticated: ready }, models: { default: "m", options: [] } });
const maus = (extra: Partial<Bot> = {}): Bot => ({ id: "maus", threadId: "t", name: "MausBot", title: "", description: "", notifications: true,
  color: "chrome", unread: false, modelSelection: { instanceId: "claude", model: "m" }, messages: [], defaultBot: {}, chiefOfStaff: true, ...extra });
const intro: Message = { id: "intro", role: "bot", kind: "options", at: 1, helperIntro: true, text: "Hi! I'm MausBot, your Chief of Staff.",
  card: { title: "Hi! I'm MausBot, your Chief of Staff.", subtitle: "", options: ["What are my bots up to?"] } };

let host: HTMLDivElement, root: Root;
const lines = () => [...host.querySelectorAll("[data-helper-line]")].map((node) => node.textContent);
const steps = () => [...host.querySelectorAll<HTMLElement>("[data-helper-step]")].map((node) => node.dataset.helperStep);
const show = async (answered = false) => {
  await act(async () => { root.render(createElement(HelperIntro, { botId: "maus", threadId: "t", message: intro, answered })); });
  for (let i = 0; i < 5; i++) await act(async () => {});
};

beforeEach(() => {
  setLocale("en");
  f.dispatch.mockReset();
  f.detect.mockReset();
  f.advanced = false;
  f.local = false;
  f.services = {};
  f.phones = [];
  f.found = null;
  f.state = { bots: [maus()], instances: [claude(true)], config: { profile: { name: "" } } };
  stageIntro(null);
  setWelcomingBot(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("what MausBot says first", () => {
  it("three short bubbles in its own voice: who it is, what to ask it, and that it is looking around", () => {
    expect(introLines({ name: "MausBot", chief: true })).toEqual([
      "Hi! I'm MausBot, your Chief of Staff.",
      "Tell me anything you need. I'll handle it or hand it to the right bot.",
      "I'm taking a look around to see what I can pick up for you.",
    ]);
    expect(introLines({ name: "Jarvis", chief: true, person: "Ada" })[0]).toBe("Hi Ada! I'm Jarvis, your Chief of Staff.");
    expect(introLines({ name: "MausBot", chief: false })[0], "another bot leads").toBe("Hi! I'm MausBot, your helper for everything here.");
    const member = introLines({ name: "MausBot", chief: false, team: "Acme" });
    expect(member[1]).toBe("Ask me how to do anything here. I can set up bots, apps and routines with you. On Acme, I'm here for you and look after your own bots.");
    expect(member[1], "a team's Chief keeps an eye on the day").not.toContain("your day");
  });

  it("reports plainly what it found, ending on the next step", () => {
    expect(lookAroundReport({ apps: [] }, ["ai"])).toBe(t("helperIntro.look.noAi"));
    expect(lookAroundReport({ apps: [], backup: "OpenCode" }, ["ai"])).toBe("I looked around. For now I think with OpenCode's free model, so connect an AI of your own first.");
    expect(lookAroundReport({ ai: "Claude", apps: [] }, ["apps"])).toBe(
      "I looked around. Claude is connected, so I can get to work. No apps are connected yet. Connect your email or calendar and I'll keep an eye on them for you. Or just hand me whatever's on your plate today.");
    expect(lookAroundReport({ ai: "Claude", apps: ["Gmail", "GitHub"] }, [])).toBe(
      "I looked around. Claude is connected, and I can use Gmail and GitHub. Hand me whatever's on your plate today.");
    expect(lookAroundReport({ ai: "Claude", apps: ["Gmail", "GitHub", "Slack", "Notion", "Linear"] }, ["bots"])).toContain("Gmail, GitHub, Slack, and 2 more");
  });
});

describe("in the chat", () => {
  it("greets by the name the person gave, then offers only what its look around found missing", async () => {
    f.state = { ...f.state, config: { profile: { name: "Ada Lovelace" } } };
    f.services = { gmail: { connected: true }, github: { connected: false } };
    await show();
    expect(lines()).toEqual([
      "Hi Ada! I'm MausBot, your Chief of Staff.",
      "Tell me anything you need. I'll handle it or hand it to the right bot.",
      "I'm taking a look around to see what I can pick up for you.",
      "I looked around. Claude is connected, and I can use Gmail. Or just hand me whatever's on your plate today.",
    ]);
    expect(steps()).toEqual(["bots", "phone", "cloud"]);
    const first = host.querySelector<HTMLElement>('[data-helper-line="0"]')!;
    expect(first.dataset.chatBubble, "the chat's own Simple bubble").toBe("simple");
    expect(first.className).toContain(SIMPLE_BOT_BUBBLE);
  });

  it("never counts OpenCode's free model as the person's own AI: it still offers to connect one", async () => {
    f.state = { ...f.state, instances: [{ instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode",
      snapshot: { state: "available", authenticated: true, freeFallback: true }, models: { default: "m", options: [] } }] };
    await show();
    expect(lines()[3]).toContain("OpenCode's free model");
    expect(steps()[0]).toBe("ai");
  });

  it("puts connecting an AI first when none works, and leaves out a phone already paired", async () => {
    f.state = { ...f.state, instances: [claude(false)] };
    f.phones = [{ key: "p1" }];
    await show();
    expect(lines()[3]).toBe(t("helperIntro.look.noAi"));
    expect(steps()).toEqual(["ai", "apps", "bots", "cloud"]);
  });

  it("offers to bring in skills this computer has, looking only from its own window", async () => {
    f.local = true;
    f.found = { skills: [{ name: "pdf", source: "claudeCode" }], tools: [] };
    await show();
    expect(steps()).toContain("import");
    expect(setupAction("import")).toEqual({ type: "toggleAppSettings", open: true, section: "import" });
  });

  it("drops the chips once the person has written, and no longer looks for skills", async () => {
    f.local = true;
    await show(true);
    expect(lines()).toHaveLength(4);
    expect(steps()).toEqual([]);
    expect(f.detect).not.toHaveBeenCalled();
  });

  it("keeps the example asks in Advanced mode only", async () => {
    await show();
    expect(host.querySelector("[data-helper-ask]")).toBeNull();
    f.advanced = true;
    await show();
    expect(host.querySelector('[data-helper-ask="helperIntro.ask.overview"]')).not.toBeNull();
  });

  it("says nothing while the Chief screen still introduces MausBot over its chat", async () => {
    setWelcomingBot("maus");
    await show();
    expect(host.querySelector("[data-helper-intro]")).toBeNull();
  });

  it("opens the app's own flow for each chip", () => {
    expect(setupAction("ai")).toEqual({ type: "toggleAppSettings", open: true, section: "engines" });
    expect(setupAction("bots")).toEqual({ type: "toggleNewBot", open: true });
    expect(setupAction("apps")).toEqual({ type: "togglePlugins", open: true, surface: "apps" });
    expect(setupAction("phone")).toMatchObject({ type: "toggleAppSettings", section: "companion", phonePairing: true });
    expect(setupAction("cloud")).toEqual({ type: "openCloudAdd", source: "app_onboarding" });
  });
});

describe("as a first run lands in the chat", () => {
  it("arrives one bubble at a time with the bot typing, the look around last, then the chips", async () => {
    vi.useFakeTimers();
    setWelcomingBot("maus");
    stageIntro("maus");
    await show();
    expect(host.querySelector("[data-helper-intro]"), "hidden behind the Chief screen").toBeNull();
    setWelcomingBot(null);
    await show();
    expect(lines()).toEqual([]);
    expect(host.querySelector("[data-helper-typing]")?.textContent).toContain("Typing…");
    for (let count = 1; count <= 4; count++) {
      await act(async () => { vi.advanceTimersByTime(ARRIVAL_MS[count - 1]!); });
      for (let i = 0; i < 3; i++) await act(async () => {});
      expect(lines(), `after ${count}`).toHaveLength(count);
      expect(steps().length > 0, `chips after ${count}`).toBe(count === 4);
    }
    expect(host.querySelector("[data-helper-typing]")).toBeNull();
  });
});
