// @vitest-environment happy-dom
// The first run: two screens, then the chat. Meeting the app (and connecting an AI when none works), then the Chief of
// Staff over the app; what it saves, where it lands, and what a reload or a replay does.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import { saveWelcomeDraft } from "@/lib/welcome-draft";
import type { InstanceInfo } from "@/state/store";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), landed: vi.fn(), onDone: vi.fn(),
  checks: [] as string[] }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: f.api }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn() }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/components/mascot-clock", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/EngineSetup", async () => {
  const { createElement: h } = await import("react");
  return { EngineSetup: ({ instance }: { instance: InstanceInfo }) => h("div", { "data-engine-setup": instance.instanceId }) };
});
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
vi.mock("@/lib/mausbot-landing", () => ({ landInSidebar: (input: { botId: string; commit: () => void }) => { f.landed(input.botId); input.commit(); } }));
const { WelcomeFlow } = await import("./WelcomeFlow");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const claude = (ready: boolean, aiTest?: InstanceInfo["aiTest"]): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", install: { docsUrl: "https://example.test" },
  snapshot: { state: ready ? "available" : "unavailable", authenticated: ready }, models: { default: "m", options: [] }, ...(aiTest ? { aiTest } : {}),
});
const freeOpenCode: InstanceInfo = {
  instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode", install: { docsUrl: "https://example.test" },
  snapshot: { state: "available", authenticated: true, freeFallback: true }, models: { default: "opencode/big-pickle", options: [] }, aiTest: "passed",
};
const maus = { id: "maus", threadId: "t", name: "MausBot", title: "", description: "", notifications: true, color: "chrome", unread: false,
  modelSelection: { instanceId: "claude", model: "m" }, messages: [], defaultBot: {}, chiefOfStaff: true };

let host: HTMLDivElement, root: Root;
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label);
const press = async (label: string) => { await act(async () => { button(label)!.click(); }); };
const key = async (name: string) => {
  const screen = host.querySelector<HTMLElement>("[data-welcome]")!;
  await act(async () => { screen.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
};
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: f.onDone, ...extra })); });
};
const saved = () => f.api.mock.calls.filter(([path, init]) => path === "/api/config" && init?.method === "PUT").map(([, init]) => JSON.parse(init.body));
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, String(v)), removeItem: (k: string) => void values.delete(k), clear: () => values.clear() };
};


beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  f.dispatch.mockReset();
  f.landed.mockReset();
  f.onDone.mockReset();
  f.api.mockReset();
  f.checks = [];
  f.api.mockImplementation(async (path: string, init?: { body?: string }) => {
    if (path.endsWith("/check")) { f.checks.push(path); return { ok: true }; }
    return path === "/api/instances" ? { instances: f.state.instances } : JSON.parse(init?.body ?? "{}");
  });
  f.state = { instances: [claude(true)], config: { onboarding: EMPTY_ONBOARDING, profile: { name: "" } }, bots: [maus], cloudAdd: null };
  stageIntro(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("a new install's first run", () => {
  it("is two screens with an AI already working: Next, then Create, and it lands in the Chief's chat", async () => {
    await show();
    expect(host.querySelector("h1")?.textContent).toBe("Meet OpenMausBot");
    expect(host.querySelector("[data-demo-composer]")?.textContent).toContain("Check my inbox every morning");
    for (const gone of ["Step 1", "Back", "Skip", "Your name", "Connect an AI", "Later"]) expect(text()).not.toContain(gone);
    expect(button("Next")!.disabled).toBe(false);

    await press("Next");
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("Introducing your Chief of Staff");
    expect(button("Choose an existing bot")!.disabled, "no bots of the person's own yet").toBe(true);

    await press("Create Chief of Staff");
    expect(f.landed).toHaveBeenCalledWith("maus");
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true } });
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus"), "its first messages arrive one at a time").toBe(true);
    await act(async () => {});
    expect(saved()).toEqual([{ onboarding: expect.objectContaining({ version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT] }) }]);
  });

  it("counts an AI once it answered one tiny test message, and never before", async () => {
    await show();
    expect(f.checks).toEqual(["/api/instances/claude/check"]);
    expect(text()).not.toContain("First, connect an AI");
    expect(button("Next")!.disabled).toBe(false);
  });

  it("still asks for the person's own AI when only OpenCode's free model works, and says it is there as a backup", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, claude(false)] };
    await show();
    expect(text()).toContain("First, connect an AI to think with");
    expect(text()).toContain("OpenCode's free model is ready as a backup");
    expect(button("Next")!.disabled).toBe(true);
    expect(f.checks).toEqual([]);
  });

  it("leaves the AI out for one that answered the server's own test, and asks for one that didn't", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, claude(true, "passed")] };
    await show();
    expect(text()).not.toContain("First, connect an AI");
    expect(f.checks).toEqual([]);
    await act(async () => root.unmount());
    root = createRoot(host);
    f.state = { ...f.state, instances: [freeOpenCode, claude(true, "failed")] };
    await show();
    expect(text()).toContain("First, connect an AI to think with");
    expect(host.querySelector("[data-ai-silent]")).not.toBeNull();
  });

  it("doesn't count an AI that offers no model yet, such as OpenCode still listing its models", async () => {
    f.state = { ...f.state, instances: [{ ...freeOpenCode, snapshot: { state: "available", authenticated: true }, models: { default: "", options: [] }, aiTest: undefined }, claude(false)] };
    await show();
    expect(text()).toContain("First, connect an AI to think with");
    expect(f.checks).toEqual([]);
  });

  it("asks for an AI on the first screen when none works: Next waits for one, Later moves on without", async () => {
    f.state = { ...f.state, instances: [claude(false)] };
    await show();
    expect(text()).toContain("First, connect an AI to think with");
    expect(host.querySelector('[data-engine-setup="claude"]')).not.toBeNull();
    expect(button("Next")!.disabled).toBe(true);
    await press("Later");
    expect(text()).toContain("Introducing your Chief of Staff");
  });

  it("lets Next go once the AI connects, and keeps the confirmation on screen", async () => {
    f.state = { ...f.state, instances: [claude(false)] };
    await show();
    f.state = { ...f.state, instances: [claude(true)] };
    await show();
    expect(text()).toContain("Connected · Claude");
    expect(button("Next")!.disabled).toBe(false);
    expect(button("Later")).toBeUndefined();
  });

  it("moves on with Escape, and with Enter as Next does, never past an AI still to connect", async () => {
    f.state = { ...f.state, instances: [claude(false)] };
    await show();
    await key("Enter");
    expect(text(), "Next is held for the AI").toContain("Meet OpenMausBot");
    await key("Escape");
    expect(text()).toContain("Introducing your Chief of Staff");
  });

  it("comes back to the second screen after a reload there", async () => {
    saveWelcomeDraft({ beat: "chief" });
    await show();
    expect(text()).toContain("Introducing your Chief of Staff");
  });
});

describe("other first runs", () => {
  it("gives a hosted place's admin the first screen only, then the chat", async () => {
    await show({ hosted: true });
    expect(text()).toContain("This is your team's shared OpenMausBot");
    await press("Next");
    expect(text()).not.toContain("Introducing your Chief of Staff");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true });
    await press("Next");
    await press("Create Chief of Staff");
    await act(async () => {});
    expect(saved()[0].onboarding).not.toHaveProperty("hintsSeen");
    expect(introStaged("maus"), "a replay lands in a chat that may be long under way").toBe(false);
  });
});
