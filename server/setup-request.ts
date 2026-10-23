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

/** The greeting whose Set me up is live in this conversation: its first line, while the bot is blank and nothing has
 * been written there yet, by anyone. The press and the person's first line also take the flag off (takeSetupRequest). */
export function openSetupOffer(store: SetupRequestStore, botId: string, threadId: string): Message | null {
  const bot = store.bot(botId);
  if (!bot || !blankBot(bot) || !store.taskByThread(botId, threadId)) return null;
  const thread = store.messagesFor(threadId);
  const greeting = thread[0];
  if (thread.some((message) => message.role === "user")) return null;
  return greeting?.setupOffer === true && greeting.role === "bot" ? greeting : null;
}

export type SetupAsk =
  | { ok: true; message: Message }
  | { ok: true; already: true }
  | { ok: false; status: 404 | 409; error: string };

const HAS_INSTRUCTIONS = "This bot already has instructions. To change its job, type /setup and what you'd like it to do.";
const STARTED = "This chat has already started. Type /setup and what you'd like this bot to do.";

/** The press. A second press while the conversation waits changes nothing, so a double click says the line once.
 * `by`: who pressed, where several people share the place; only their next line takes the mark. */
export function askForSetup(store: SetupRequestStore, botId: string, threadId: string, language: string | undefined, by?: string): SetupAsk {
  const bot = store.bot(botId);
  const task = bot ? store.taskByThread(botId, threadId) : null;
  if (!bot || !task) return { ok: false, status: 404, error: "There is no such conversation." };
  if (task.setupRequest) return { ok: true, already: true };
  const offer = openSetupOffer(store, botId, threadId);
  if (!offer) return { ok: false, status: 409, error: blankBot(bot) ? STARTED : HAS_INSTRUCTIONS };
  store.patchMessage(threadId, offer.id, { setupOffer: undefined });
  const message = store.appendMessage(threadId, { role: "bot", kind: "text", text: setupRequestLine(language) });
  store.patchTask(botId, threadId, { setupRequest: { at: message.at, ...(by ? { by } : {}) } });
  return { ok: true, message };
}

/** The x on the chip: the conversation stops waiting. Where a presser is recorded, only they may. */
export function cancelSetupRequest(store: SetupRequestStore, botId: string, threadId: string, by?: string): "cleared" | "refused" | "unknown" {
  const task = store.bot(botId) ? store.taskByThread(botId, threadId) : null;
  if (!task) return "unknown";
  if (task.setupRequest?.by && task.setupRequest.by !== by) return "refused";
  if (task.setupRequest) store.patchTask(botId, threadId, { setupRequest: undefined });
  return "cleared";
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

const command = (line: Message): boolean => (line.text ?? "").trimStart().startsWith("/");

/** The stored line, marked, when this turn is a setup request; null when it runs as typed. Called by startTurn once the
 * line is stored, which keeps the returned copy: a retry on the backup AI, a computer pick or an edit of it then stays
 * a setup request. */
export function takeSetupRequest(store: SetupRequestStore, turn: SetupTurn): Message | null {
  const { botId, threadId, line } = turn;
  if (line.role !== "user" || line.peerAsk) return null;
  if (line.setupRequest) return turn.mounted ? line : null;
  const edited = turn.editedFrom ? store.messagesFor(threadId).find((message) => message.id === turn.editedFrom) : undefined;
  if (edited?.setupRequest) return command(line) ? null : mark(store, threadId, line, turn.mounted);
  if (!turn.person || line.relayed) return null;
  const greeting = store.messagesFor(threadId)[0];
  if (greeting?.setupOffer) store.patchMessage(threadId, greeting.id, { setupOffer: undefined });
  const waiting = store.taskByThread(botId, threadId)?.setupRequest;
  if (!waiting) return null;
  // Someone else in a shared place: their line runs as typed and the presser's request keeps waiting.
  if (waiting.by && line.sender?.id !== waiting.by) return null;
  store.patchTask(botId, threadId, { setupRequest: undefined });
  // A command typed instead (/learn, a skill, or /setup itself) runs as typed; so does any line once the bot has been
  // given instructions some other way.
  const bot = store.bot(botId);
  if (command(line) || !bot || !blankBot(bot)) return null;
  return mark(store, threadId, line, turn.mounted);
}

function mark(store: SetupRequestStore, threadId: string, line: Message, mounted: boolean): Message | null {
  if (!mounted) return null;
  return store.patchMessage(threadId, line.id, { setupRequest: true }) ?? { ...line, setupRequest: true };
}

/** What the bot reads for a setup request: the person's words as a typed /setup. A typed /setup never carries the
 * Data tab's context (shared/data-context.ts), so neither does this. */
export function setupCommandText(text: string): string {
  return parseSetupCommand(text) ? text : `/setup ${text}`;
}
