// @vitest-environment happy-dom
// Simple mode's composer: one pill with a round + (attach; in a room also Finish together), chips for a mode while it is
// not the default, and one round button in the bot's colour that calls, sends or stops. Advanced keeps its row of buttons.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";
import { MAUS_COLORS } from "@/lib/mascot";
import { setCallMode } from "@/lib/call-mode";

const fixture = vi.hoisted(() => ({
  advanced: false,
  dispatch: vi.fn(),
  call: null as Record<string, unknown> | null,
  groupCall: null as Record<string, unknown> | null,
  liveCall: null as unknown,
}));
const ENGINE = "claude-3f0c2b1e-9d1a-4c55-8a51-0a3a6f1e2b7c";
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot, peer], liveCall: fixture.liveCall, instances: [{
      instanceId: ENGINE, driverKind: "claudeAgent", displayName: "Claude", capabilities: { agentsMcp: true },
    }] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/cloud-guest")>(), useReactor: () => "user" }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: vi.fn() }));
vi.mock("./CallView", () => ({ CallButton: (props: Record<string, unknown>) => {
  fixture.call = props;
  return null;
} }));
vi.mock("./GroupCallView", () => ({ GroupCallButton: (props: Record<string, unknown>) => {
  fixture.groupCall = props;
  return null;
} }));

import { Composer } from "./Composer";

const bot: Bot = {
  id: "atlas", threadId: "atlas-thread", name: "Atlas", title: "", description: "",
  color: "purple", notifications: false, unread: false, busy: false, messages: [], approvalMode: "ask",
  modelSelection: { instanceId: ENGINE, model: "fake" },
};
const peer: Bot = { ...bot, id: "juniper", threadId: "juniper-thread", name: "Juniper", color: "teal" };
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch planning", memberIds: [bot.id, peer.id],
  defaultResponder: { kind: "member", botId: bot.id }, bulletin: "", unread: false,
  createdAt: 1, setupCompletedAt: 1, messages: [],
};

let root: Root;
let container: HTMLDivElement;
const render = (props: Parameters<typeof Composer>[0]) => flushSync(() => root.render(createElement(Composer, props)));
const plus = () => container.querySelector<HTMLElement>("[data-composer-plus]")?.closest("button") ?? null;
const menu = () => document.body.querySelector<HTMLElement>("[data-composer-menu]");
const popover = () => document.body.querySelector<HTMLElement>('[data-sidebar-popover-menu="anchored"]');
const item = (key: string) => document.body.querySelector<HTMLButtonElement>(`[data-menu-key="${key}"]`);
const click = (element: Element | null) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => (element as HTMLElement).click());
};
function openPlus() {
  click(plus());
  expect(menu()).not.toBeNull();
}

beforeEach(() => {
  fixture.advanced = false;
  fixture.liveCall = null;
  setCallMode("turns");
  fixture.call = null;
  fixture.groupCall = null;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  for (const id of [`bot:${bot.id}:${bot.threadId}`, `group:${room.id}:${room.threadId}`]) restoreComposerDraft(id, { text: "", attachments: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Simple composer in a bot chat", () => {
  it("is one pill: a round + that attaches, the field, and one round button in the bot's colour", () => {
    render({ bot });
    expect(plus()?.getAttribute("aria-label")).toBe("Add");
    const pill = container.querySelector('[data-tour="composer"]')!.className.split(" ");
    expect(pill).toEqual(expect.arrayContaining(["rounded-[22px]", "bg-composer", "p-2", "ring-[0.5px]"]));
    expect(pill.some((name) => name.startsWith("shadow"))).toBe(false);
    expect(container.querySelector("[data-composer-row]")!.className).not.toContain("flex-wrap");
    expect(container.querySelector("[data-composer-plus]")!.className.split(" ")).toContain("size-7");
    expect(container.querySelector('button[aria-label="Attach a file"]')).toBeNull();
    expect(container.querySelector('[aria-label="Work until done"]')).toBeNull();
    expect(container.querySelector("[data-approval-chip]")).toBeNull();
    expect(fixture.call).toMatchObject({ bot: { id: "atlas" }, placement: "composer", fill: MAUS_COLORS.purple });
    openPlus();
    expect([...menu()!.querySelectorAll("[data-menu-key]")].map((row) => row.getAttribute("data-menu-key"))).toEqual(["attach"]);
    expect(menu()!.textContent).toBe("Attach files");
    const row = menu()!.querySelector("[data-menu-key='attach']")!.className.split(" ");
    expect(row).toEqual(expect.arrayContaining(["h-[34px]", "text-[15px]"]));
    expect(menu()!.className.split(" ")).toEqual(expect.arrayContaining(["rounded-[14px]", "w-[200px]"]));
  });

  it("rounds its corners in from 22 to 18 once the message takes a second line", () => {
    restoreComposerDraft(`bot:${bot.id}:${bot.threadId}`, { text: "one\ntwo", attachments: [] });
    render({ bot });
    const pill = container.querySelector('[data-tour="composer"]')!;
    expect(pill.hasAttribute("data-multiline")).toBe(true);
    expect(pill.className.split(" ")).toContain("rounded-[18px]");
  });

  it("sets the composer on plain canvas from its top edge down, with no fade above it", () => {
    render({ bot });
    const backdrop = container.querySelector("[data-composer-backdrop]")!.className.split(" ");
    expect(backdrop).toEqual(expect.arrayContaining(["bg-app", "top-0", "-bottom-4", "-left-5", "-right-5"]));
    expect(backdrop.some((name) => /gradient|blur|^from-|^to-|^opacity/.test(name))).toBe(false);
  });

  it("attaches through the same file picker as the paperclip", () => {
    const picker = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    render({ bot });
    openPlus();
    click(item("attach"));
    expect(picker).toHaveBeenCalledOnce();
    expect(plus()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("turns its round button into Send while there is text, in the bot's colour", () => {
    restoreComposerDraft(`bot:${bot.id}:${bot.threadId}`, { text: "hello", attachments: [] });
    render({ bot });
    const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
    expect(send.className.split(" ")).toContain("size-7");
    expect(send.style.backgroundColor).not.toBe("");
    expect(fixture.call).toBeNull();
  });

  it("turns its round button into Stop while the bot works, and keeps a quiet Stop beside Send while you type", () => {
    const busy = { ...bot, busy: true };
    render({ bot: busy });
    const slot = container.querySelector<HTMLButtonElement>('[data-composer-stop="slot"]')!;
    expect(slot.getAttribute("aria-label")).toBe("Stop this turn");
    expect(slot.style.backgroundColor).not.toBe("");
    expect(fixture.call).toBeNull();
    click(slot);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "interrupt", botId: "atlas", threadId: "atlas-thread" });

    restoreComposerDraft(`bot:${bot.id}:${bot.threadId}`, { text: "and also this", attachments: [] });
    render({ bot: busy });
    expect(container.querySelector('[data-composer-stop="beside"]')).not.toBeNull();
    expect(container.querySelector('[data-composer-stop="slot"]')).toBeNull();
  });

  it("shows the approval level as a chip only while it is not the default, and changes this thread's level from it", () => {
    render({ bot });
    expect(container.querySelector("[data-approval-chip]")).toBeNull();
    render({ bot: { ...bot, approvalMode: "full" } });
    const chip = container.querySelector("[data-approval-chip]")!;
    expect(chip.getAttribute("data-approval-chip")).toBe("full");
    expect(chip.textContent).toBe("Full access");
    click(chip.closest("button"));
    const level = popover()!;
    expect(level.textContent).toContain("Command allowlist");
    expect(level.querySelector('[data-menu-key="approval:full"] .lucide-check')).not.toBeNull();
    click(level.querySelector('[data-menu-key="approval:ask"]'));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "updateTask", botId: "atlas", threadId: "atlas-thread", patch: { approvalMode: "ask" } });
  });

  it("shows Work until done as a chip only while it is on, and turns it off from there", () => {
    restoreComposerDraft(`bot:${bot.id}:${bot.threadId}`, { text: "", attachments: [], channelMode: "goal" });
    render({ bot });
    const chip = container.querySelector<HTMLButtonElement>('[aria-label="Work until done"]')!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.className.split(" ")).toContain("h-7");
    click(chip);
    expect(container.querySelector('[aria-label="Work until done"]')).toBeNull();
  });
});

describe("the composer after Set me up", () => {
  it("asks for the job and shows a chip to stop it while the conversation waits, and neither once it does not", () => {
    render({ bot: { ...bot, tasks: [{ threadId: bot.threadId, title: "New thread", createdAt: 1, setupRequest: { at: 2 } }] } });
    expect(container.querySelector("textarea")!.getAttribute("placeholder")).toBe("Tell Atlas what you'd like help with");
    expect(container.querySelector("[data-setup-request]")?.textContent).toContain("Atlas is ready to be set up");
    expect(container.querySelector(`[aria-label="Stop setting up Atlas"]`)).not.toBeNull();
    render({ bot: { ...bot, tasks: [{ threadId: bot.threadId, title: "New thread", createdAt: 1 }] } });
    expect(container.querySelector("textarea")!.getAttribute("placeholder")).toBe("Message Atlas");
    expect(container.querySelector("[data-setup-request]")).toBeNull();
  });
});

describe("the Simple composer in a group chat", () => {
  it("offers Finish together in the + menu and keeps the Goal chip in view while it is on", () => {
    render({ group: room, members: [bot, peer] });
    expect(container.querySelector('[aria-label="Finish together"]')).toBeNull();
    expect(fixture.groupCall).toMatchObject({ group: { id: "room" }, placement: "composer", fill: "var(--color-accent)" });
    openPlus();
    expect([...menu()!.querySelectorAll("[data-menu-key]")].map((row) => row.getAttribute("data-menu-key"))).toEqual(["attach", "goal"]);
    click(item("goal"));
    const chip = container.querySelector('[aria-label="Finish together"]');
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("textarea")!.getAttribute("placeholder")).toContain("finish together");
    openPlus();
    expect(item("goal")!.querySelector(".lucide-check")).not.toBeNull();
    click(chip);
    expect(container.querySelector('[aria-label="Finish together"]')).toBeNull();
  });
});

describe("the Advanced composer", () => {
  it("keeps the paperclip, the approval shield and the split call button, with no +", () => {
    fixture.advanced = true;
    render({ bot });
    expect(plus()).toBeNull();
    expect(container.querySelector('button[aria-label="Attach a file"]')).not.toBeNull();
    expect(container.querySelector('[aria-haspopup="menu"][aria-label$="for Claude"]')).not.toBeNull();
    expect(fixture.call).toMatchObject({ placement: "composer" });
    expect(fixture.call?.fill).toBeUndefined();
    expect(container.querySelector("[data-composer-backdrop]")!.className.split(" ")).toContain("top-1/2");
  });

  it("keeps the room's Goal chip and its header call button", () => {
    fixture.advanced = true;
    render({ group: room, members: [bot, peer] });
    expect(container.querySelector('[aria-label="Finish together"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(fixture.groupCall).toBeNull();
  });
});
