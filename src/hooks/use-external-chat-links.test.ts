import type { EffectCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState, type Action, type AppState, type Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ effects: [] as EffectCallback[], link: null as string | null, showThreads: true }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [fixture.link, (next: string | null) => { fixture.link = next; }],
  useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); },
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.showThreads }));

import { useExternalChatLinks } from "./use-external-chat-links";

const scout: Bot = {
  id: "scout", threadId: "scout-main", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [{ threadId: "scout-main", title: "Main", createdAt: 1 }],
};
const loading: AppState = { ...initialState, bots: [], selectedId: "" };
const loaded: AppState = { ...initialState, bots: [scout], selectedId: "scout", hydrated: true };

/** One render: run its effects in order, as React would after commit. */
function render(state: AppState, dispatch: (action: Action) => void) {
  fixture.effects = [];
  useExternalChatLinks(state, dispatch);
  return fixture.effects.map((effect) => effect());
}

afterEach(() => { vi.unstubAllGlobals(); fixture.effects = []; fixture.link = null; fixture.showThreads = true; });

/** A window with only the DOM plumbing the hook listens on, for shell-event delivery.
 * `queued` is the shell's before-mount deep link queue (window.ombDeepLinkQueue). */
function stubShellWindow(queued: [string, string][] = []): {
  fire: (name: string, detail: unknown) => void;
  removed: string[];
  remainingQueue: () => [string, string][] | undefined;
} {
  const listeners = new Map<string, (event: unknown) => void>();
  const removed: string[] = [];
  const shellWindow: { addEventListener: (name: string, cb: (event: unknown) => void) => void; removeEventListener: (name: string) => void; ombDeepLinkQueue?: [string, string][] } = {
    addEventListener: (name, cb) => { listeners.set(name, cb); },
    removeEventListener: (name) => { listeners.delete(name); removed.push(name); },
    ombDeepLinkQueue: queued,
  };
  vi.stubGlobal("window", shellWindow);
  return { fire: (name, detail) => { listeners.get(name)?.({ detail }); }, removed, remainingQueue: () => shellWindow.ombDeepLinkQueue };
}

describe("useExternalChatLinks", () => {
  it("holds a link that arrives at launch until the bots have loaded, then opens it once", () => {
    let deliver: ((link: string) => void) | undefined;
    const unsubscribe = vi.fn();
    vi.stubGlobal("window", {
      ogb: { onChatLink: (cb: (link: string) => void) => { deliver = cb; return unsubscribe; } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const dispatch = vi.fn();

    const [cleanup] = render(loading, dispatch);
    expect(typeof cleanup).toBe("function");
    deliver!("openmausbot://bot/scout");
    render(loading, dispatch);
    expect(dispatch).not.toHaveBeenCalled();

    render(loaded, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "revealThread", threadId: "scout-main" },
    ]);
    expect(fixture.link).toBeNull();

    dispatch.mockClear();
    render(loaded, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("opens the chat link the phone shell delivers as a DOM event", () => {
    const shell = stubShellWindow();
    const dispatch = vi.fn();

    const [cleanup] = render(loaded, dispatch);
    shell.fire("omb:chat-link", "openmausbot://bot/scout");
    render(loaded, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "revealThread", threadId: "scout-main" },
    ]);

    cleanup!();
    expect(shell.removed).toContain("omb:chat-link");
  });

  it("opens a link the shell queued before the page mounted its listeners", () => {
    const shell = stubShellWindow([["omb:chat-link", "openmausbot://bot/scout"]]);
    const dispatch = vi.fn();

    render(loading, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    render(loaded, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "revealThread", threadId: "scout-main" },
    ]);
    expect(shell.remainingQueue()).toEqual([]);
  });

  it("closes Settings and the shortcuts list so the linked chat is not left behind them", () => {
    stubShellWindow();
    fixture.link = "openmausbot://bot/scout";
    const dispatch = vi.fn();
    render({ ...loaded, appSettingsOpen: true, shortcutsOpen: true }, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "toggleAppSettings", open: false },
      { type: "toggleShortcuts", open: false },
      { type: "select", id: "scout" },
      { type: "revealThread", threadId: "scout-main" },
    ]);
  });

  it("opens a bot's link as its row would: at its main thread while threads are hidden", () => {
    stubShellWindow();
    fixture.link = "openmausbot://bot/scout";
    fixture.showThreads = false;
    const dispatch = vi.fn();
    const left = { ...scout, threadId: "scout-report", mainThreadId: "scout-main",
      tasks: [...scout.tasks!, { threadId: "scout-report", title: "Report", createdAt: 2, unread: true }] };
    render({ ...loaded, bots: [left] }, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "switchTask", botId: "scout", threadId: "scout-main" },
      { type: "revealThread", threadId: "scout-main" },
    ]);
  });

  it("does nothing without a link or the desktop bridge", () => {
    const shell = stubShellWindow();
    const dispatch = vi.fn();
    const [cleanup, follow] = render(loaded, dispatch);
    expect(typeof cleanup).toBe("function");
    expect(follow).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();

    cleanup!();
    expect(shell.removed).toContain("omb:chat-link");
  });
});
