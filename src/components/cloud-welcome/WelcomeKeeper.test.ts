// @vitest-environment happy-dom
import { createElement, Fragment } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudMoveBridge, CloudMoveOverview, CloudMoveState } from "../../../electron/cloud-move.mjs";
import { EMPTY_ONBOARDING } from "@/lib/onboarding";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const value = {
    state: {} as any,
    listeners,
    api: null as any,
    set(next: any) { value.state = next; listeners.forEach((listener) => listener()); },
    dispatch(action: any) {
      if (action.type === "profileSaved") value.set({ ...value.state, config: { ...value.state.config, profile: { ...value.state.config.profile, ...action.profile } } });
      if (action.type === "configStatus") value.set({ ...value.state, config: action.config });
    },
  };
  return value;
});
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => { fixture.listeners.add(listener); return () => { fixture.listeners.delete(listener); }; };
  return {
    ...actual,
    api: (...args: unknown[]) => fixture.api(...args),
    useStore: () => ({ state: useSyncExternalStore(subscribe, () => fixture.state), dispatch: fixture.dispatch, refreshInstances: vi.fn() }),
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/components/CloudTrialNotice", () => ({ useCloudPlanSnapshot: () => null }));
vi.mock("@/components/EngineSetup", () => ({ EngineSetup: () => null }));
vi.mock("@/components/TeamLibraryPanel", () => ({ TeamLibraryPanel: () => null }));
import { CloudWelcome } from "./CloudWelcome";
import { WelcomeKeeper } from "./WelcomeKeeper";
import { pendingMemory, rememberPendingMemory, resetCloudWelcome, useCloudWelcome } from "@/lib/cloud-welcome";

function useCloudWelcomeNow() {
  let value: ReturnType<typeof useCloudWelcome> | null = null;
  function Probe() { value = useCloudWelcome(); return null; }
  const probeHost = document.createElement("div");
  const probe = createRoot(probeHost);
  flushSync(() => probe.render(createElement(Probe)));
  flushSync(() => probe.unmount());
  return value!;
}

const owner = { hosted: false, canSave: true, cloudHome: true };
const local = { bots: 6, rooms: 1, chats: 142, bytes: 1024 ** 3, files: 900, routines: 4 };
const CLOUD = { id: "cloud", name: "Studio Cloud", origin: "https://omb-u-1a2b3c4d5e6f.fly.dev", kind: "cloud" as const };
const emptyCloud = { contents: { bots: 1, rooms: 0, chats: 0 }, empty: true, freeBytes: 9 * 1024 ** 3, previous: null, heldBytes: 0 };
const copiedCloud = { ...emptyCloud, contents: { bots: 6, rooms: 1, chats: 142 }, empty: false };
const overview = (extra: Partial<CloudMoveOverview> = {}): CloudMoveOverview => ({
  phase: "idle", local, cloud: emptyCloud, suggest: true, destination: CLOUD, blocked: null, fit: { fit: "now", neededBytes: 1, freeBytes: 2 }, ...extra,
});
const PASTE = "- Likes tea";

let host: HTMLDivElement;
let root: Root;
let bridge: CloudMoveBridge;
let push: (state: CloudMoveState) => void;
let failProfile = false;

function Harness() {
  const welcome = useCloudWelcome();
  return createElement(Fragment, null, welcome.ended ? null : createElement(CloudWelcome), createElement(WelcomeKeeper, { viewer: owner }));
}
const mount = () => flushSync(() => root.render(createElement(Harness)));
const text = () => document.body.textContent ?? "";
const click = (label: string) => {
  const target = [...document.body.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!target) throw new Error(`no button "${label}" in: ${text()}`);
  flushSync(() => target.click());
};
const aboutMePuts = () => fixture.api.mock.calls.map(([, init]: [string, RequestInit]) => JSON.parse(String(init.body)).profile?.aboutMe).filter(Boolean);
let server: any;
/** What a copy does to the Cloud: its About me changes there, and the page learns of it. */
const setAboutMe = (aboutMe: string) => {
  server = { ...server, profile: { ...server.profile, aboutMe } };
  flushSync(() => fixture.set({ ...fixture.state, config: { ...fixture.state.config, profile: { ...fixture.state.config.profile, aboutMe } } }));
};
const restartApp = (next: CloudMoveOverview) => {
  flushSync(() => root.unmount());
  resetCloudWelcome();
  vi.mocked(bridge.state).mockResolvedValue(next);
  root = createRoot(host);
  mount();
};

beforeEach(() => {
  setLocale("en");
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
  resetCloudWelcome();
  failProfile = false;
  fixture.state = {
    connected: true, selectedId: "b1", activeView: "chat", routines: [], groups: [], bots: [{ id: "b1", threadId: "t1", name: "Maus" }], instances: [{ instanceId: "claude" }],
    config: { cloudHome: true, onboarding: { ...EMPTY_ONBOARDING }, profile: { name: "", email: "", aboutMe: "Cloud About me." } },
  };
  server = structuredClone(fixture.state.config);
  // Like the server: each save applies when it arrives, and every answer is the whole config as it is then.
  fixture.api = vi.fn((_path: string, init?: RequestInit) => {
    const patch = JSON.parse(String(init?.body ?? "{}"));
    if (patch.profile && failProfile) return Promise.reject(Object.assign(new Error("Settings are already being updated. Try again in a moment."), { status: 409 }));
    server = {
      ...server,
      ...(patch.onboarding ? { onboarding: { ...server.onboarding, ...patch.onboarding } } : {}),
      ...(patch.profile ? { profile: { ...server.profile, ...patch.profile } } : {}),
    };
    return Promise.resolve().then(() => structuredClone(server));
  });
  push = () => {};
  bridge = {
    state: vi.fn().mockResolvedValue(overview()), start: vi.fn().mockResolvedValue({ phase: "preparing" }), cancel: vi.fn(), restorePrevious: vi.fn(),
    dismiss: vi.fn().mockResolvedValue(overview({ suggest: false })), onState: vi.fn((callback) => { push = callback; return () => {}; }),
  };
  window.ogb = { platform: "darwin", cloudMove: bridge, workspaces: { state: vi.fn().mockResolvedValue({ local: false, name: "Studio Cloud" }), menu: vi.fn() } } as unknown as typeof window.ogb;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete window.ogb;
  vi.unstubAllGlobals();
});

describe("memory pasted in the welcome", () => {
  it("is added to About me, and only then said to be", async () => {
    mount();
    click("Memory from Claude or ChatGPT");
    const box = document.querySelector<HTMLTextAreaElement>("#cloud-memory-answer")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, PASTE);
    flushSync(() => box.dispatchEvent(new Event("input", { bubbles: true })));
    click("Add to About me");
    await vi.waitFor(() => expect(aboutMePuts()).toEqual(["Cloud About me.\n\n- Likes tea"]));
    await vi.waitFor(() => expect(text()).toContain("Added to About me."));
    expect(pendingMemory()).toBe(PASTE);
  });

  it("after the app restarted with a copy landed, is added to the About me the copy brought, and kept until the welcome moves on", async () => {
    rememberPendingMemory(PASTE);
    fixture.state.config.profile.aboutMe = server.profile.aboutMe = "This Mac's own About me.";
    vi.mocked(bridge.state).mockResolvedValue(overview({ cloud: copiedCloud, suggest: false }));
    mount();
    expect(text()).not.toContain("Added to About me.");
    await vi.waitFor(() => expect(aboutMePuts()).toEqual(["This Mac's own About me.\n\n- Likes tea"]));
    await vi.waitFor(() => expect(text()).toContain("Added to About me."));
    expect(pendingMemory()).toBe(PASTE);
    click("Skip setup");
    await vi.waitFor(() => expect(pendingMemory()).toBeNull());
    expect(localStorage.getItem("omb.cloudWelcome.memory")).toBeNull();
  });

  it("survives Skip setup while a copy runs, reaches the About me the copy brings, and goes only once that is saved", async () => {
    rememberPendingMemory(PASTE);
    mount();
    await vi.waitFor(() => expect(aboutMePuts()).toEqual(["Cloud About me.\n\n- Likes tea"]));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("button.ui-button-primary")?.textContent).toBe("Copy to Studio Cloud"));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("button.ui-button-primary")?.disabled).toBe(false));
    click("Copy to Studio Cloud");
    flushSync(() => push({ phase: "uploading", action: "move", destination: CLOUD, progress: { bytesTransferred: 1, totalBytes: 4 } }));
    click("Skip setup");
    flushSync(() => push({ phase: "done", action: "move", destination: CLOUD, moved: { bots: 6, rooms: 1, chats: 142 } }));
    expect(pendingMemory()).toBe(PASTE);
    setAboutMe("This Mac's own About me.");
    await vi.waitFor(() => expect(aboutMePuts()).toEqual(["Cloud About me.\n\n- Likes tea", "This Mac's own About me.\n\n- Likes tea"]));
    await vi.waitFor(() => expect(fixture.state.config.profile.aboutMe).toBe("This Mac's own About me.\n\n- Likes tea"));
    expect(pendingMemory()).toBe(PASTE);
    restartApp(overview({ cloud: copiedCloud, suggest: false }));
    await vi.waitFor(() => expect(pendingMemory()).toBeNull());
    expect(aboutMePuts()).toHaveLength(2);
  });

  it("is not let go while the page is still learning what the Cloud has, before its engines answer", async () => {
    rememberPendingMemory(PASTE);
    fixture.state = { ...fixture.state, instances: [], config: { ...fixture.state.config, profile: { ...fixture.state.config.profile, aboutMe: "Cloud About me.\n\n- Likes tea" } } };
    server.profile.aboutMe = "Cloud About me.\n\n- Likes tea";
    mount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pendingMemory()).toBe(PASTE);
    flushSync(() => fixture.set({ ...fixture.state, instances: [{ instanceId: "claude" }] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pendingMemory()).toBe(PASTE);
    expect(aboutMePuts()).toEqual([]);
  });

  it("when it no longer fits the About me a copy brought, stays on this device and is shown again with why", async () => {
    rememberPendingMemory(PASTE);
    fixture.state.config.profile.aboutMe = server.profile.aboutMe = "x".repeat(23_990);
    vi.mocked(bridge.state).mockResolvedValue(overview({ cloud: copiedCloud, suggest: false }));
    mount();
    await vi.waitFor(() => expect(document.querySelector('[data-cloud-memory="too-long"]')).not.toBeNull());
    await vi.waitFor(() => expect(text()).toContain("isn't in About me on Studio Cloud yet. This device keeps it until it is"));
    expect(text()).toContain("About me holds up to 24,000 characters. Remove 3 to add this.");
    expect(document.querySelector<HTMLTextAreaElement>("#cloud-memory-answer")!.value).toBe(PASTE);
    expect(aboutMePuts()).toEqual([]);
    click("Later");
    expect(pendingMemory()).toBe(PASTE);
  });

  it("when saving fails, stays on this device and is shown again; adding it again retries, and Discard lets it go", async () => {
    rememberPendingMemory(PASTE);
    failProfile = true;
    mount();
    await vi.waitFor(() => expect(document.querySelector('[data-cloud-memory="failed"]')).not.toBeNull());
    expect(text()).toContain("It couldn't be saved. Try again.");
    expect(pendingMemory()).toBe(PASTE);
    failProfile = false;
    click("Add to About me");
    await vi.waitFor(() => expect(aboutMePuts()).toEqual(["Cloud About me.\n\n- Likes tea", "Cloud About me.\n\n- Likes tea"]));
    await vi.waitFor(() => expect(document.querySelector("[data-cloud-memory]")).toBeNull());
    expect(pendingMemory()).toBe(PASTE);
    failProfile = true;
    setAboutMe("Another About me.");
    await vi.waitFor(() => expect(document.querySelector('[data-cloud-memory="failed"]')).not.toBeNull());
    click("Discard it");
    expect(pendingMemory()).toBeNull();
    expect(document.querySelector("[data-cloud-memory]")).toBeNull();
  });
});

describe("an end of the welcome kept on this device", () => {
  it("reaches the Cloud's record when it can, and is then let go", async () => {
    localStorage.setItem("omb.cloudWelcome.done", "1");
    resetCloudWelcome();
    mount();
    expect(text()).not.toContain("What should Studio Cloud start with?");
    await vi.waitFor(() => expect(server.onboarding.hintsSeen).toContain("cloud-welcome-done"));
    await vi.waitFor(() => expect(localStorage.getItem("omb.cloudWelcome.done")).toBeNull());
    expect(useCloudWelcomeNow().doneHere).toBe(false);
  });
});

