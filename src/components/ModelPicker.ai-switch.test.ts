// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: (() => {}) as (...args: unknown[]) => void, instances: [] as unknown[] }));
const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/api", () => ({ api, ApiError: Error }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: [], modelVariantSessions: {}, config: {} },
    dispatch: fixture.dispatch,
    refreshInstances: () => Promise.resolve(),
    refreshModels: () => Promise.resolve(),
  }),
}));

const { ModelPicker } = await import("./ModelPicker");
const { cancelAiSwitch, requestAiSwitch } = await import("@/lib/ai-switch");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const available = { state: "available", version: "1.0.0", authenticated: true } as const;
const opencode = {
  instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode", access: "subscription", snapshot: available,
  models: { default: "free", options: [{ id: "free", label: "Free model" }] },
} as unknown as InstanceInfo;
const codex = {
  instanceId: "codex", driverKind: "codex", displayName: "Codex", access: "subscription", snapshot: available,
  models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
} as unknown as InstanceInfo;
const busyBot = {
  id: "maus", threadId: "thread-1", name: "Maus", title: "", description: "", notifications: true, color: "green", unread: false,
  busy: true, modelSelection: { instanceId: "opencodeGo", model: "free" }, messages: [],
} as unknown as Bot;

let host: HTMLDivElement;
let root: Root;
const trigger = () => host.querySelector<HTMLButtonElement>('[data-tour="model"]')!;
const buttonNamed = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
  .find((button) => button.getAttribute("aria-label") === name || button.textContent?.includes(name));

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ ok: true });
  fixture.dispatch = vi.fn();
  fixture.instances = [opencode, codex];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(ModelPicker, { bot: busyBot, threadId: "thread-1" })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  cancelAiSwitch();
});

describe("the header model chip and Switch AI", () => {
  it("stays shut while the bot works, until Switch AI asks for it", () => {
    expect(trigger().disabled).toBe(true);
    act(() => requestAiSwitch({ botId: "maus", threadId: "thread-1", turnId: "turn-1", place: "header" }));
    expect(trigger().disabled).toBe(false);
    expect(host.querySelector("[data-model-picker-content]")).not.toBeNull();
  });

  it("stops that turn, not the store's model, when another AI is picked", () => {
    act(() => requestAiSwitch({ botId: "maus", threadId: "thread-1", turnId: "turn-1", place: "header" }));
    // Codex sits on the rail as its sign-in family, OpenAI.
    act(() => buttonNamed("OpenAI")!.click());
    act(() => buttonNamed("GPT-5.6")!.click());
    expect(api).toHaveBeenCalledWith("/api/bots/maus/interrupt", { method: "POST", body: JSON.stringify({ threadId: "thread-1", turnId: "turn-1" }) });
    expect(vi.mocked(fixture.dispatch).mock.calls.filter(([action]) => (action as { type: string }).type === "setModel")).toEqual([]);
  });

  it("ignores an intent for another place", () => {
    act(() => requestAiSwitch({ botId: "maus", threadId: "thread-1", turnId: "turn-1", place: "panel" }));
    expect(trigger().disabled).toBe(true);
  });
});
