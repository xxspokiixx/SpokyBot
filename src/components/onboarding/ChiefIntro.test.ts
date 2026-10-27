// @vitest-environment happy-dom
// The first run's second screen: MausBot as the Chief of Staff (Create) or a bot the person already has (Choose).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro, useWelcomingBot } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

const f = vi.hoisted(() => ({ state: {} as { bots: Bot[]; instances: unknown[] }, dispatch: vi.fn(), landed: vi.fn(), onDone: vi.fn(), reduced: true }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }) }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/components/mascot-clock", () => ({ usePrefersReducedMotion: () => f.reduced }));
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
vi.mock("@/lib/mausbot-landing", () => ({ landInSidebar: (input: { botId: string; commit: () => void }) => { f.landed(input.botId); input.commit(); } }));
const { ChiefIntro } = await import("./ChiefIntro");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-t`, name, title: "", description: "", notifications: true, color: "blue", unread: false,
  modelSelection: { instanceId: "claude", model: "m" }, messages: [], ...extra,
});
const maus = (extra: Partial<Bot> = {}) => bot("maus", "MausBot", { defaultBot: {}, chiefOfStaff: true, color: "chrome", ...extra });
const CLAUDE = { instanceId: "claude", capabilities: { agentsMcp: true } };
const CHAT_ONLY = { instanceId: "chat-only", capabilities: { agentsMcp: false } };

let host: HTMLDivElement, root: Root;
let welcoming: string | null = null;
function Watch() {
  welcoming = useWelcomingBot();
  return null;
}
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label);
const press = async (label: string) => { await act(async () => { button(label)!.click(); }); };
const show = async (replay = false) => {
  await act(async () => { root.render([createElement(Watch, { key: "w" }), createElement(ChiefIntro, { key: "c", replay, onDone: f.onDone })]); });
};
const patches = () => f.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === "updateBot");

beforeEach(() => {
  setLocale("en");
  f.dispatch.mockReset();
  f.landed.mockReset();
  f.onDone.mockReset();
  f.reduced = true;
  f.state = { bots: [maus()], instances: [CLAUDE, CHAT_ONLY] };
  stageIntro(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Create", () => {
  it("finishes on its own clock, even in a window that runs no animation frames", async () => {
    vi.useFakeTimers();
    f.reduced = false;
    HTMLElement.prototype.animate = vi.fn(() => ({ onfinish: null, oncancel: null }) as unknown as Animation);
    await show();
    await press("Create Chief of Staff");
    expect(f.onDone).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    vi.useRealTimers();
  });

  it("on a new install introduces MausBot, already its Chief, lands it in the sidebar and opens its chat", async () => {
    await show();
    expect(text()).toContain("Introducing your Chief of Staff");
    expect(text()).toContain("Your main point of contact. It checks in on its own and coordinates work with your other bots.");
    expect(welcoming, "kept out of the sidebar until it lands").toBe("maus");
    await press("Create Chief of Staff");
    expect(patches()).toEqual([{ type: "updateBot", botId: "maus", patch: { welcomed: true } }]);
    expect(f.landed).toHaveBeenCalledWith("maus");
    expect(welcoming).toBeNull();
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus")).toBe(true);
  });

  it("makes MausBot the Chief where the place has none, and brings it back to the sidebar", async () => {
    f.state = { ...f.state, bots: [maus({ chiefOfStaff: false, sidebarHidden: true })] };
    await show();
    await press("Create Chief of Staff");
    expect(patches()).toEqual([{ type: "updateBot", botId: "maus", patch: { welcomed: true, sidebarHidden: false, chiefOfStaff: true } }]);
  });

  it("is never offered over a Chief the person already has, whose role MausBot never takes", async () => {
    f.state = { ...f.state, bots: [maus({ chiefOfStaff: false }), bot("research", "Research", { chiefOfStaff: true })] };
    await show();
    expect(button("Create Chief of Staff")).toBeUndefined();
    expect(text()).toContain("Meet Research, your Chief of Staff");
    await press("Continue with Research");
    expect(patches()).toEqual([{ type: "updateBot", botId: "maus", patch: { welcomed: true } }]);
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("research");
  });
});

describe("Choose an existing bot", () => {
  it("is off while there is nothing to choose", async () => {
    await show();
    expect(button("Choose an existing bot")!.disabled).toBe(true);
  });

  it("lists the person's own bots to pick one, any whose AI cannot lead held back, and Confirm makes it the Chief", async () => {
    f.state = { ...f.state, bots: [maus(), bot("research", "Research"), bot("writer", "Writer", { modelSelection: { instanceId: "chat-only", model: "m" } }),
      bot("sales", "Sales", { section: "Sales" }), bot("gone", "Gone", { hidden: true })] };
    await show();
    await press("Choose an existing bot");
    expect(text()).toContain("Choose your Chief of Staff");
    const choices = [...host.querySelectorAll<HTMLElement>("[role=radio]")];
    expect(choices.map((choice) => choice.dataset.chiefChoice)).toEqual(["research", "writer"]);
    expect(choices[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(choices[1]!.textContent).toContain("This model cannot contact other bots");
    expect(button("Confirm")!.disabled, "nothing picked yet").toBe(true);
    await act(async () => { choices[1]!.click(); });
    expect(button("Confirm")!.disabled, "a bot that cannot lead is never picked").toBe(true);
    await act(async () => { choices[0]!.click(); });
    expect(choices[0]!.getAttribute("aria-checked")).toBe("true");
    expect(f.dispatch, "nothing changes before Confirm").not.toHaveBeenCalled();
    await press("Confirm");
    expect(patches()).toEqual([
      { type: "updateBot", botId: "maus", patch: { welcomed: true } },
      { type: "updateBot", botId: "research", patch: { chiefOfStaff: true } },
    ]);
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("research");
    expect(introStaged("maus"), "MausBot's first messages are not where the person lands").toBe(false);
  });

  it("picks with the arrow keys, and goes back to the introduction with Back or Escape", async () => {
    f.state = { ...f.state, bots: [maus(), bot("research", "Research"), bot("inbox", "Inbox")] };
    await show();
    await press("Choose an existing bot");
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(host.querySelector('[aria-checked="true"]')?.getAttribute("data-chief-choice")).toBe("inbox");
    await press("Back");
    expect(text()).toContain("Introducing your Chief of Staff");
    await press("Choose an existing bot");
    await act(async () => { host.querySelector<HTMLElement>("[role=dialog]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(text()).toContain("Introducing your Chief of Staff");
    expect(f.onDone).not.toHaveBeenCalled();
  });
});

describe("the introduction", () => {
  it("asks for a choice: Escape changes nothing and closes nothing", async () => {
    await show();
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.onDone).not.toHaveBeenCalled();
    expect(text()).toContain("Introducing your Chief of Staff");
    expect(welcoming).toBe("maus");
  });
});
