// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAdvancedMode } from "@/lib/interface-mode";
import { StoreContext, type Bot, type InstanceInfo, type Message } from "@/state/store";
import type { FirstReplyRescue } from "../../shared/first-reply-rescue";
import { PERSON_STOPPED_TURN_NAME, STOPPED_TURN_NAME } from "../../shared/client-cancel";
import { CancelledTurnRow } from "./CancelledTurnRow";
import { StatusActivityRow } from "./StatusActivityRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rescue: FirstReplyRescue = { botId: "bot-1", threadId: "thread-1", instanceId: "opencodeGo", ai: "OpenCode" };
const row = (payload: FirstReplyRescue = rescue): Message => ({
  id: "m-1", at: 1, role: "bot", kind: "activity", turnId: "turn-1",
  tool: { name: payload.settled ? "notice: OpenCode answered after a slow start." : "notice: Maus hasn't heard back from OpenCode yet.", ok: true, rescue: payload },
} as Message);
const bot = (busy: boolean): Bot => ({
  id: "bot-1", threadId: "thread-1", name: "Maus", title: "", description: "", notifications: true, color: "green", unread: false, messages: [], busy,
  modelSelection: { instanceId: "opencodeGo", model: "free" }, tasks: [{ threadId: "thread-1", title: "Chat", createdAt: 1, busy }],
} as unknown as Bot);
const engine = { instanceId: "opencodeGo", displayName: "OpenCode", driverKind: "opencodeGo", models: { default: "free", options: [] } } as unknown as InstanceInfo;

let host: HTMLDivElement;
let root: Root;
let dispatch: ReturnType<typeof vi.fn>;

function render(message: Message, busy = true) {
  const value = { state: { bots: [bot(busy)], instances: [engine], groups: [] }, dispatch } as never;
  act(() => root.render(createElement(StoreContext.Provider, { value }, createElement(StatusActivityRow, { message }))));
}
const button = (label: string) => Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent === label);
/** Stands in for the model picker's trigger where this mode draws it. */
function picker(scope: string, disabled: boolean) {
  const area = document.createElement("div");
  area.setAttribute(scope, scope === "data-panel-row" ? "model" : "");
  const trigger = document.createElement("button");
  trigger.setAttribute("data-tour", "model");
  trigger.disabled = disabled;
  const clicked = vi.fn();
  trigger.addEventListener("click", clicked);
  area.append(trigger);
  document.body.append(area);
  return { trigger, clicked };
}

beforeEach(() => {
  vi.useFakeTimers();
  dispatch = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  setAdvancedMode(false);
  vi.useRealTimers();
});

describe("first-reply rescue row", () => {
  it("says who is waiting on which AI, as a quiet notice with two ways out", () => {
    render(row());
    expect(host.textContent).toContain("Maus hasn't heard back from OpenCode yet.");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button("Switch AI")).toBeDefined();
    expect(button("Connect your subscription")).toBeDefined();
  });

  it("goes away once the AI starts answering", () => {
    render(row({ ...rescue, settled: true }));
    expect(host.textContent).toBe("");
  });

  it("opens Settings at the AI providers for Connect your subscription", () => {
    render(row());
    act(() => button("Connect your subscription")!.click());
    expect(dispatch.mock.calls).toEqual([[{ type: "toggleAppSettings", open: true, section: "engines" }]]);
  });

  it("in Simple mode, stops the silent turn and opens the bot panel's model picker once it can change", () => {
    setAdvancedMode(false);
    render(row());
    act(() => button("Switch AI")!.click());
    expect(dispatch.mock.calls[0]).toEqual([{ type: "interrupt", botId: "bot-1", threadId: "thread-1" }]);
    expect(dispatch.mock.calls[1]).toEqual([expect.objectContaining({ type: "toggleSettings", open: true, section: "model", botId: "bot-1" })]);
    const { trigger, clicked } = picker("data-panel-row", true);
    act(() => void vi.advanceTimersByTime(500));
    expect(clicked).not.toHaveBeenCalled();
    trigger.disabled = false;
    act(() => void vi.advanceTimersByTime(500));
    expect(clicked).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("in Advanced mode, opens the header's model chip instead", () => {
    setAdvancedMode(true);
    render(row(), false);
    const { clicked } = picker("data-chathead-controls", false);
    act(() => button("Switch AI")!.click());
    act(() => void vi.advanceTimersByTime(200));
    expect(dispatch).not.toHaveBeenCalled();
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});

describe("stopped row", () => {
  it("tells the person they stopped it, in plain grey words", () => {
    act(() => root.render(createElement(CancelledTurnRow, { name: PERSON_STOPPED_TURN_NAME })));
    expect(host.textContent).toBe("You stopped this.");
    act(() => root.render(createElement(CancelledTurnRow, { name: STOPPED_TURN_NAME })));
    expect(host.textContent).toBe("Stopped");
  });
});
