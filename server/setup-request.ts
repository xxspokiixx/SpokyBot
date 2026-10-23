// Set me up, under a new bot's greeting. The press is answered here, with no model: the bot's own line, the button
// gone, and the conversation marked as waiting (on its task, so a reload or another device sees it). The person's next
// line there then runs exactly as `/setup <their words>` would (server/setup-mode.ts), while the chat shows their
// words. Setup stays explicit: only the press, or a typed /setup, ever starts it.
import { setupRequestLine } from "./initial-greeting.ts";
import { parseSetupCommand } from "./setup-mode.ts";
import type { BotRecord, Message, Store } from "./store.ts";

export type SetupRequestStore = Pick<Store, "bot" | "taskByThread" | "messagesFor" | "patchMessage" | "appendMessage" | "patchTask">;

/** No role or instructions yet: what the New bot form calls Description and Instructions are empty. */
export function blankBot(bot: Pick<BotRecord, "soul" | "description">): boolean {
  return !bot.soul?.trim() && !bot.description?.trim();
}

/** The greeting whose Set me up is live in this conversation: its first line, while the bot is blank. The offer is
 * withdrawn when it is pressed or the person writes (takeSetupRequest). */
export function openSetupOffer(store: SetupRequestStore, botId: string, threadId: string): Message | null {
  const bot = store.bot(botId);
  if (!bot || !blankBot(bot) || !store.taskByThread(botId, threadId)) return null;
  const greeting = store.messagesFor(threadId)[0];
  return greeting?.setupOffer === true && greeting.role === "bot" ? greeting : null;
}

export type SetupAsk =
  | { ok: true; message: Message }
  | { ok: true; already: true }
  | { ok: false; status: 404 | 409; error: string };

/** The press. A second press while the conversation waits changes nothing, so a double click says the line once. */
export function askForSetup(store: SetupRequestStore, botId: string, threadId: string, language: string | undefined): SetupAsk {
  const task = store.bot(botId) ? store.taskByThread(botId, threadId) : null;
  if (!task) return { ok: false, status: 404, error: "There is no such conversation." };
  if (task.setupRequest) return { ok: true, already: true };
  const offer = openSetupOffer(store, botId, threadId);
  if (!offer) return { ok: false, status: 409, error: "This bot is already set up. To change its job, type /setup and what you'd like it to do." };
  store.patchMessage(threadId, offer.id, { setupOffer: undefined });
  const message = store.appendMessage(threadId, { role: "bot", kind: "text", text: setupRequestLine(language) });
  store.patchTask(botId, threadId, { setupRequest: { at: message.at } });
  return { ok: true, message };
}

/** The × on "Setting up …": the conversation stops waiting. */
export function cancelSetupRequest(store: SetupRequestStore, botId: string, threadId: string): boolean {
  const task = store.bot(botId) ? store.taskByThread(botId, threadId) : null;
  if (!task) return false;
  if (task.setupRequest) store.patchTask(botId, threadId, { setupRequest: undefined });
  return true;
}

export interface SetupTurn {
  botId: string;
  threadId: string;
  /** The stored line this turn answers. */
  line: Message;
  /** The person wrote it here: not a routine, another bot, a card, a coordination or an edit. */
  person: boolean;
  /** The line an edit replaced. */
  editedFrom?: string;
  /** The bot's model can set itself up (its tools are mounted); without them the line runs as typed. */
  mounted: boolean;
}

/** Whether this turn is a setup request; called by startTurn once the line is stored. The person's line after a press
 * takes the mark and is marked itself, so a retry, a computer pick or an edit of it stays a setup request. */
export function takeSetupRequest(store: SetupRequestStore, turn: SetupTurn): boolean {
  const { botId, threadId, line } = turn;
  if (line.role !== "user" || line.peerAsk) return false;
  if (line.setupRequest) return turn.mounted;
  const edited = turn.editedFrom ? store.messagesFor(threadId).find((message) => message.id === turn.editedFrom) : undefined;
  if (edited?.setupRequest) return mark(store, threadId, line, turn.mounted);
  if (!turn.person || line.relayed) return false;
  const greeting = store.messagesFor(threadId)[0];
  if (greeting?.setupOffer) store.patchMessage(threadId, greeting.id, { setupOffer: undefined });
  const task = store.taskByThread(botId, threadId);
  if (!task?.setupRequest) return false;
  store.patchTask(botId, threadId, { setupRequest: undefined });
  // A command the person typed instead (/learn, a skill, or /setup itself) runs as they typed it.
  if ((line.text ?? "").trimStart().startsWith("/")) return false;
  return mark(store, threadId, line, turn.mounted);
}

function mark(store: SetupRequestStore, threadId: string, line: Message, mounted: boolean): boolean {
  if (!mounted) return false;
  store.patchMessage(threadId, line.id, { setupRequest: true });
  return true;
}

/** What the bot reads for a setup request: the person's words as a typed /setup. */
export function setupCommandText(text: string): string {
  return parseSetupCommand(text) ? text : `/setup ${text}`;
}
