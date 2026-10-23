// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Action, Bot } from "@/state/store";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/api", () => ({ api, ApiError: Error }));

const { cancelAiSwitch, requestAiSwitch, useAiSwitch, useAiSwitchFinish } = await import("./ai-switch");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = (busy: boolean): Bot => ({
  id: "bot-1", threadId: "thread-1", name: "Maus", title: "", description: "", notifications: true, color: "green", unread: false, busy,
  modelSelection: { instanceId: "opencodeGo", model: "free" },
  messages: [{ id: "ask-1", at: 1, role: "user", kind: "text", text: "Plan my week" }],
} as unknown as Bot);
const intent = { botId: "bot-1", threadId: "thread-1", turnId: "turn-1", requestMessageId: "ask-1", place: "header" as const };
const toClaude: Action = { type: "setModel", botId: "bot-1", threadId: "thread-1", selection: { instanceId: "claude", model: "opus" } };

let host: HTMLDivElement;
let root: Root;
let seen: { bot: Bot; dispatch: (action: Action) => void } | null;

/** Stands in for a model picker: the hook's bot and dispatch are what the picker uses. */
function Picker(props: { bot: Bot; contained?: boolean; threadId?: string; store: (action: Action) => void; setOpen: (open: boolean) => void }) {
  seen = useAiSwitch({ bot: props.bot, threadId: props.threadId ?? "thread-1", contained: props.contained ?? false, dispatch: props.store, setOpen: props.setOpen });
  return null;
}
/** Stands in for the rescue row, which carries the switch through once the stopped turn has ended. */
function Row(props: { busy: boolean; store: (action: Action) => void }) {
  useAiSwitchFinish({ botId: "bot-1", threadId: "thread-1", turnId: "turn-1", busy: props.busy, messages: bot(props.busy).messages, dispatch: props.store });
  return null;
}
const flush = async () => { for (let index = 0; index < 10; index++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  api.mockReset();
  seen = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  cancelAiSwitch();
});

describe("Switch AI", () => {
  it("opens only the picker it names, once, and lets it open while the turn runs", () => {
    const header = vi.fn();
    const panel = vi.fn();
    const store = vi.fn();
    act(() => root.render(createElement("div", null,
      createElement(Picker, { bot: bot(true), store, setOpen: header }),
      createElement(Picker, { bot: bot(true), contained: true, store, setOpen: panel }))));
    act(() => requestAiSwitch(intent));
    expect(header).toHaveBeenCalledWith(true);
    expect(panel).not.toHaveBeenCalled();
    act(() => root.render(createElement(Picker, { bot: bot(true), store, setOpen: header })));
    expect(header).toHaveBeenCalledTimes(1);
    expect(seen!.bot.busy).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  it("leaves another thread's picker alone", () => {
    const other = vi.fn();
    act(() => root.render(createElement(Picker, { bot: bot(true), threadId: "thread-2", store: vi.fn(), setOpen: other })));
    act(() => requestAiSwitch(intent));
    expect(other).not.toHaveBeenCalled();
    expect(seen!.bot.busy).toBe(true);
  });

  it("stops that exact turn only when another AI is picked, then switches and asks again once it has ended", async () => {
    api.mockResolvedValue({ ok: true });
    const store = vi.fn();
    act(() => root.render(createElement("div", null,
      createElement(Picker, { bot: bot(true), store, setOpen: vi.fn() }),
      createElement(Row, { busy: true, store }))));
    act(() => requestAiSwitch(intent));
    act(() => seen!.dispatch(toClaude));
    expect(api).toHaveBeenCalledWith("/api/bots/bot-1/interrupt", { method: "POST", body: JSON.stringify({ threadId: "thread-1", turnId: "turn-1" }) });
    await flush();
    // The server refuses a model change mid-turn: nothing is sent until the stopped turn has ended.
    expect(store).not.toHaveBeenCalled();
    act(() => root.render(createElement("div", null,
      createElement(Picker, { bot: bot(false), store, setOpen: vi.fn() }),
      createElement(Row, { busy: false, store }))));
    await flush();
    expect(store.mock.calls).toEqual([
      [toClaude],
      [{ type: "editMessage", botId: "bot-1", threadId: "thread-1", messageId: "ask-1", text: "Plan my week" }],
    ]);
  });

  it("switches without asking again when the turn was already over", async () => {
    api.mockResolvedValue({ ok: true, outcome: "already-stopped" });
    const store = vi.fn();
    act(() => root.render(createElement("div", null,
      createElement(Picker, { bot: bot(true), store, setOpen: vi.fn() }),
      createElement(Row, { busy: false, store }))));
    act(() => requestAiSwitch(intent));
    act(() => seen!.dispatch(toClaude));
    await flush();
    expect(store.mock.calls).toEqual([[toClaude]]);
  });

  it("stops nothing when the same AI is picked, and passes other actions through", async () => {
    const store = vi.fn();
    act(() => root.render(createElement(Picker, { bot: bot(true), store, setOpen: vi.fn() })));
    act(() => requestAiSwitch(intent));
    const same: Action = { type: "setModel", botId: "bot-1", threadId: "thread-1", selection: { instanceId: "opencodeGo", model: "free" } };
    act(() => seen!.dispatch(same));
    act(() => seen!.dispatch({ type: "toggleAppSettings", open: true, section: "engines" }));
    expect(api).not.toHaveBeenCalled();
    expect(store.mock.calls).toEqual([[same], [{ type: "toggleAppSettings", open: true, section: "engines" }]]);
  });

  it("is called off when the person leaves the chat, and the picker goes back to waiting for the turn", () => {
    const store = vi.fn();
    act(() => root.render(createElement("div", null,
      createElement(Picker, { bot: bot(true), store, setOpen: vi.fn() }),
      createElement(Row, { busy: true, store }))));
    act(() => requestAiSwitch(intent));
    expect(seen!.bot.busy).toBe(false);
    act(() => root.render(createElement(Picker, { bot: bot(true), store, setOpen: vi.fn() })));
    expect(seen!.bot.busy).toBe(true);
  });
});
