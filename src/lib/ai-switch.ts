// "Switch AI" on the first-reply rescue, as one scoped intent: { bot, thread, turn } and the picker it opens (the bot
// panel's in Simple mode, the chat header's in Advanced). Only that picker takes it. While it holds the intent it opens
// even though the turn runs, and nothing happens to the turn until the person picks another AI: then that exact turn
// is stopped, and once the chat has gone idle the new AI is set (wherever the person is by then). The same message is
// sent again on it only while the row is still on screen, the message is still the conversation's last word from the
// person, no other turn has run since, and a resend would carry all of it; otherwise Retry stays theirs to press.
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { api } from "@/state/api";
import type { Action, Bot, Message } from "@/state/store";
import { turnStartCount } from "./stop-turn";

/** How long the chat must stay idle before the switch lands: a queued message starts its turn right after the stop. */
export const AI_SWITCH_SETTLE_MS = 500;

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
/** A pick waiting for its turn to end: `stopped` is null until the Stop is answered, false when the turn was over.
 * `starts`: how many turns this client had seen start in the thread when the pick was made. */
type Pending = { intent: Held; action: SetModel; stopped: boolean | null; starts: number };

let intent: Held | null = null;
let pending: Pending | null = null;
let nonce = 0;
const rowsOnScreen = new Set<string>();
const watchers = new Set<() => void>();
const notify = () => { for (const watch of Array.from(watchers)) watch(); };
const subscribe = (watch: () => void) => {
  watchers.add(watch);
  return () => { watchers.delete(watch); };
};
const rowKey = (match: { threadId: string; turnId: string }) => `${match.threadId}\n${match.turnId}`;

/** A pick already made keeps going: a new intent only replaces the one waiting for a pick. */
export function requestAiSwitch(next: AiSwitchIntent): void {
  intent = { ...next, nonce: ++nonce, opened: false };
  notify();
}

/** The row's turn is no longer the one running, or the row is gone: its picker goes back to waiting for whatever
 * runs. A pick already made keeps going. */
export function releaseAiSwitchIntent(match: { threadId: string; turnId: string }): void {
  if (!intent || intent.threadId !== match.threadId || intent.turnId !== match.turnId) return;
  intent = null;
  notify();
}

/** Tests only: no intent, no pick, no rows. */
export function resetAiSwitch(): void {
  intent = null;
  pending = null;
  rowsOnScreen.clear();
  notify();
}

const sameAi = (a: SetModel["selection"], b: SetModel["selection"]) => a.instanceId === b.instanceId && a.model === b.model;

function beginSwitch(held: Held, action: SetModel, showError: (message: string) => void): void {
  intent = null;
  const starts = turnStartCount(held.threadId);
  pending = { intent: held, action, stopped: null, starts };
  notify();
  const mine = () => pending?.intent === held;
  // The Stop names the row's turn: if another turn runs by now, the server stops nothing.
  api(`/api/bots/${held.botId}/interrupt`, { method: "POST", body: JSON.stringify({ threadId: held.threadId, turnId: held.turnId }) })
    .then((result: { outcome?: unknown } | null) => {
      if (!mine()) return;
      pending = { intent: held, action, stopped: result?.outcome !== "already-stopped", starts };
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
        const ours = action.type === "setModel" && action.botId === mine.botId && (action.threadId ?? bot.threadId) === mine.threadId;
        const switching = ours && !sameAi(action.selection, bot.modelSelection);
        if (switching && busy) beginSwitch(mine, action, (message) => dispatch({ type: "error", message }));
        // The same AI mid-turn (a thinking level, say): the server refuses any change until the turn ends.
        else if (ours && busy) return;
        else dispatch(action);
        // The turn ended before the pick: an ordinary switch, and the picker is ordinary again.
        if (switching && !busy) releaseAiSwitchIntent(mine);
      },
    };
  }, [mine, bot, dispatch]);
}

/** For the rescue row: says it is on screen (what a resend needs), and gives up the intent once its turn is no longer
 * the one running or the row goes. */
export function useAiSwitchRow(input: { threadId: string; turnId: string; live: boolean }): void {
  const { threadId, turnId, live } = input;
  useEffect(() => {
    const key = rowKey({ threadId, turnId });
    rowsOnScreen.add(key);
    return () => {
      rowsOnScreen.delete(key);
      releaseAiSwitchIntent({ threadId, turnId });
    };
  }, [threadId, turnId]);
  useEffect(() => {
    if (!live) releaseAiSwitchIntent({ threadId, turnId });
  }, [live, threadId, turnId]);
}

const threadBusy = (bot: Bot | undefined, threadId: string) => {
  const task = bot?.tasks?.find((candidate) => candidate.threadId === threadId);
  return task ? Boolean(task.busy) : Boolean(bot && bot.threadId === threadId && bot.busy);
};

/** What is sent again, or nothing: the request must still be the person's last word in the conversation on screen,
 * and all of it must ride in its words (images and files do, as tags). */
function resendable(waiting: Pending, bot: Bot | undefined): Message | undefined {
  const { threadId, turnId, requestMessageId } = waiting.intent;
  if (!waiting.stopped || !requestMessageId || !bot || bot.threadId !== threadId) return undefined;
  if (!rowsOnScreen.has(rowKey({ threadId, turnId })) || turnStartCount(threadId) !== waiting.starts) return undefined;
  const last = bot.messages.findLast((message) => message.role === "user");
  if (!last || last.id !== requestMessageId || last.kind !== "text" || !last.text?.trim()) return undefined;
  // The wire carries a data-context row on the message even where this client's type leaves it out.
  const { dataContext } = last as Message & { dataContext?: unknown };
  const carried = !last.attachments?.length && !last.pointed?.length && !dataContext && !last.fromApp && last.via !== "call";
  return carried ? last : undefined;
}

/** For the app shell, always mounted: once the stopped turn's chat has stayed idle, sets the new AI, and sends the
 * same message again when it still can. */
export function useAiSwitchKeeper(input: { bots: readonly Bot[]; dispatch: (action: Action) => void }): void {
  const { bots, dispatch } = input;
  const waiting = useSyncExternalStore(subscribe, () => pending, () => null);
  const bot = waiting ? bots.find((candidate) => candidate.id === waiting.intent.botId) : undefined;
  const busy = waiting ? threadBusy(bot, waiting.intent.threadId) : false;
  useEffect(() => {
    if (!waiting || waiting.stopped === null || busy) return;
    const timer = setTimeout(() => {
      if (pending !== waiting) return;
      pending = null;
      notify();
      const again = resendable(waiting, bot);
      dispatch(waiting.action);
      if (again?.text) dispatch({ type: "editMessage", botId: waiting.intent.botId, threadId: waiting.intent.threadId, messageId: again.id, text: again.text });
    }, AI_SWITCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [waiting, busy, bot, dispatch]);
}
