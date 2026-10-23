// "Switch AI" on the first-reply rescue, as one scoped intent: { bot, thread, turn } and the picker it opens (the bot
// panel's in Simple mode, the chat header's in Advanced). Only that picker takes it. While it holds the intent it opens
// even though the turn runs, and nothing happens to the turn until the person picks another AI: then that exact turn
// is stopped, and once it has ended the new AI is set and the same message is sent again on it. Closing the picker
// leaves the turn running; leaving the chat calls the whole thing off.
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { api } from "@/state/api";
import type { Action, Bot, Message } from "@/state/store";

export interface AiSwitchIntent {
  botId: string;
  threadId: string;
  turnId: string;
  /** The person's message the turn answers: what is sent again on the new AI. */
  requestMessageId?: string;
  place: "panel" | "header";
}

type SetModel = Extract<Action, { type: "setModel" }>;
/** `opened`: its picker has opened for it once; a picker that mounts again does not open again. */
type Held = AiSwitchIntent & { nonce: number; opened: boolean };
/** A pick waiting for its turn to end: `stopped` is null until the Stop is answered, false when the turn was over. */
type Pending = { intent: Held; action: SetModel; stopped: boolean | null };

let intent: Held | null = null;
let pending: Pending | null = null;
let nonce = 0;
const watchers = new Set<() => void>();
const notify = () => { for (const watch of Array.from(watchers)) watch(); };
const subscribe = (watch: () => void) => {
  watchers.add(watch);
  return () => { watchers.delete(watch); };
};

export function requestAiSwitch(next: AiSwitchIntent): void {
  intent = { ...next, nonce: ++nonce, opened: false };
  pending = null;
  notify();
}

/** Calls off the intent and any pick still waiting: for one turn, or (no argument) everywhere. */
export function cancelAiSwitch(match?: { threadId: string; turnId: string }): void {
  const ours = (held: Held) => !match || (held.threadId === match.threadId && held.turnId === match.turnId);
  const held = intent && ours(intent);
  const waiting = pending && ours(pending.intent);
  if (held) intent = null;
  if (waiting) pending = null;
  if (held || waiting) notify();
}

const sameAi = (a: SetModel["selection"], b: SetModel["selection"]) => a.instanceId === b.instanceId && a.model === b.model;

function beginSwitch(held: Held, action: SetModel, showError: (message: string) => void): void {
  intent = null;
  pending = { intent: held, action, stopped: null };
  notify();
  const mine = () => pending?.intent === held;
  // The Stop names the row's turn: if another turn runs by now, the server stops nothing.
  api(`/api/bots/${held.botId}/interrupt`, { method: "POST", body: JSON.stringify({ threadId: held.threadId, turnId: held.turnId }) })
    .then((result: { outcome?: unknown } | null) => {
      if (!mine()) return;
      pending = { intent: held, action, stopped: result?.outcome !== "already-stopped" };
      notify();
    })
    .catch((error: unknown) => {
      if (mine()) pending = null;
      notify();
      showError(error instanceof Error ? error.message : String(error));
    });
}

/** For a model picker: the bot and dispatch it should use. Holding the intent, it opens once, opens while the turn
 * runs, and hands a pick of another AI to the switch instead of the store. */
export function useAiSwitch(input: {
  bot: Bot;
  threadId: string | undefined;
  contained: boolean;
  dispatch: (action: Action) => void;
  setOpen: (open: boolean) => void;
}): { bot: Bot; dispatch: (action: Action) => void } {
  const { bot, threadId, contained, dispatch, setOpen } = input;
  const current = useSyncExternalStore(subscribe, () => intent, () => null);
  const mine = current && current.botId === bot.id && current.threadId === threadId
    && current.place === (contained ? "panel" : "header") ? current : null;
  useEffect(() => {
    if (!mine || mine.opened) return;
    mine.opened = true;
    setOpen(true);
  }, [mine, setOpen]);
  return useMemo(() => {
    if (!mine) return { bot, dispatch };
    const busy = Boolean(bot.busy);
    return {
      bot: busy ? { ...bot, busy: false } : bot,
      dispatch: (action: Action) => {
        const switching = action.type === "setModel" && action.botId === mine.botId && (action.threadId ?? bot.threadId) === mine.threadId
          && !sameAi(action.selection, bot.modelSelection);
        if (switching && busy) beginSwitch(mine, action, (message) => dispatch({ type: "error", message }));
        else dispatch(action);
      },
    };
  }, [mine, bot, dispatch]);
}

/** For the rescue row, which stays on screen while its chat does: carries a pick through once the stopped turn has
 * ended, and calls the switch off when the row goes (the person left the chat). */
export function useAiSwitchFinish(input: {
  botId: string;
  threadId: string;
  turnId: string;
  busy: boolean;
  messages: readonly Message[];
  dispatch: (action: Action) => void;
}): void {
  const { botId, threadId, turnId, busy, messages, dispatch } = input;
  const waiting = useSyncExternalStore(subscribe, () => pending, () => null);
  useEffect(() => {
    if (!waiting || pending !== waiting || waiting.intent.threadId !== threadId || waiting.intent.turnId !== turnId) return;
    if (waiting.stopped === null || busy) return;
    pending = null;
    notify();
    dispatch(waiting.action);
    const asked = waiting.stopped && waiting.intent.requestMessageId
      ? messages.find((message) => message.id === waiting.intent.requestMessageId && message.role === "user")
      : undefined;
    if (asked?.text) dispatch({ type: "editMessage", botId, threadId, messageId: asked.id, text: asked.text });
  }, [waiting, busy, threadId, turnId, botId, messages, dispatch]);
  useEffect(() => () => cancelAiSwitch({ threadId, turnId }), [threadId, turnId]);
}
