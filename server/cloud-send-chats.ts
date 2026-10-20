// Keep My Cloud up to date's chats, by row, never as a copy. This computer lists each bot conversation's newest stored
// row (GET /api/cloud-send/chats) and hands main the rows stored after the last one My Cloud took (GET
// /api/cloud-send/chats/rows); My Cloud adds them as Bring newer chats adds a copy's (cloud-chat-merge.ts): only what it
// lacks, never replacing or deleting anything. A conversation's history therefore goes once, and then only what is new.
// Admin scope (request-auth's default) on both sides.
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { z } from "zod";

import { ATTACHMENTS_DIR, FILE_MAX_BYTES } from "./attachments.ts";
import { activePath, addSentChats, attachmentNames, ATTACHMENT_NAME, type ChatStore, type SentConversation, type SentRoom } from "./cloud-chat-merge.ts";
import { threadHeads, threadRowNumbers, threadRowsFrom } from "./message-db.ts";
import type { RouteContext } from "./routes/table.ts";
import type { BotRecord, GroupRecord, GroupTaskRecord, Message, TaskRecord } from "./store.ts";

export const CHAT_ROWS_PAGE = 300;
/** A page's rows past its first, by their stored size: main sends a few pages per request, under CHATS_BODY_MAX. */
export const CHAT_PAGE_BYTES = 2 * 1024 * 1024;
/** One row bigger than this goes shortened, so no single message can keep a conversation from going. */
export const CHAT_ROW_MAX = 1024 * 1024;
export const CHATS_BODY_MAX = 8 * 1024 * 1024;
const SHORTENED = "\n\n[Shortened: this message was too long to copy to My Cloud.]";
const PREFIX = "/api/cloud-send/chats";

/** A bot's conversation (`bot`) or a room's (`room`). */
export type ChatHead = ({ bot: string; room?: never } | { room: string; bot?: never }) & { threadId: string; last: number; lastId: string; busy: boolean };
type Room = Pick<GroupRecord, "id" | "threadId" | "tasks" | "dm" | "busyBotId">;

/** A room's conversations: its threads, or its one conversation when it has none. Bot-to-bot channels are not rooms. */
const roomThreads = (room: Room): string[] => room.dm ? [] : room.tasks?.length ? room.tasks.map((task) => task.threadId) : [room.threadId];

/** Every bot and room conversation with stored rows: its newest row, and whether a bot is answering in it now. */
export function chatHeads(bots: readonly BotRecord[], rooms: readonly Room[] = [], heads = threadHeads()): ChatHead[] {
  const out: ChatHead[] = [];
  const seen = new Set<string>();
  const add = (owner: { bot: string } | { room: string }, threadId: string, busy: boolean) => {
    const head = heads.get(threadId);
    if (!head || seen.has(threadId)) return;
    seen.add(threadId);
    out.push({ ...owner, threadId, last: head.last, lastId: head.lastId, busy });
  };
  for (const bot of bots) {
    add({ bot: bot.id }, bot.threadId, Boolean(bot.busy));
    for (const task of bot.tasks ?? []) add({ bot: bot.id }, task.threadId, Boolean(task.busy));
  }
  for (const room of rooms) for (const threadId of roomThreads(room)) add({ room: room.id }, threadId, Boolean(room.busyBotId));
  return out;
}

/**
 * A conversation's rows stored after `after`, oldest first. `after` counts only while its row is still `afterId`: a
 * deleted row's number can be given out again, so otherwise the conversation starts over (`restarted`), which adding by
 * id makes harmless. A legacy row without a parent takes the row before it.
 *
 * `path` is the conversation's active path, root first. A page never ends between a row of it and a row above it on it,
 * which an inserted row can be stored after, and `leaf` is the deepest row of it whose rows up from the root all are at or
 * before the page's end: where the conversation stands for whoever has every page up to this one.
 */
export function threadRowsAfter(threadId: string, after: number, afterId: string | null, limit: number, maxBytes = Number.POSITIVE_INFINITY, path: readonly string[] = []):
  { rows: Message[]; leaf: string | null; last: number; lastId: string | null; more: boolean; restarted: boolean } {
  const numbers = threadRowNumbers(threadId);
  const held = after > 0 && afterId !== null && numbers.get(afterId) === after;
  const from = held ? after : 0;
  let found = threadRowsFrom(threadId, from, { limit: limit + 1 });
  // A page holds at most `limit` rows and, past its first row, at most `maxBytes` of them.
  let kept = 0, bytes = 0;
  while (kept < Math.min(found.length, limit) && (kept === 0 || bytes + found[kept]!.bytes <= maxBytes)) bytes += found[kept++]!.bytes;
  // The path's rows, each with the highest number among it and the path rows above it.
  const onPath: Array<{ id: string; at: number; highest: number }> = [];
  for (const id of path) {
    const at = numbers.get(id);
    if (at === undefined) break;
    onPath.push({ id, at, highest: Math.max(onPath.at(-1)?.highest ?? 0, at) });
  }
  const highest = new Map(onPath.map((row) => [row.at, row.highest]));
  const reach = (rows: ReadonlyArray<{ at: number }>) => rows.reduce((most, row) => Math.max(most, highest.get(row.at) ?? 0), 0);
  let count = kept;
  while (count > 0 && reach(found.slice(0, count)) > found[count - 1]!.at) count--;
  if (!count && kept) {
    for (let end = reach(found.slice(0, 1)); ;) {
      found = threadRowsFrom(threadId, from, { through: end });
      if (reach(found) > end) { end = reach(found); continue; }
      count = found.length;
      found.push(...threadRowsFrom(threadId, end, { limit: 1 }));
      break;
    }
  }
  const more = found.length > count;
  found.length = count;
  let previous: string | null = null, previousAt = 0;
  if (from) for (const [id, at] of numbers) if (at <= from && at > previousAt) { previous = id; previousAt = at; }
  const rows = found.map(({ message }) => {
    if (message.parentId === undefined) message.parentId = previous;
    previous = message.id;
    return message;
  });
  const end = found.at(-1)?.at ?? from;
  let leaf: string | null = null;
  for (const row of onPath) { if (row.highest > end) break; leaf = row.id; }
  return { rows, leaf, last: end, lastId: found.at(-1)?.message.id ?? (held ? afterId : null), more, restarted: after > 0 && !held };
}

/** A row as it goes: whole, or past CHAT_ROW_MAX its text cut and only what a message is kept. */
export function fittedRow(row: Message): Message {
  if (Buffer.byteLength(JSON.stringify(row), "utf8") <= CHAT_ROW_MAX) return row;
  const { id, at, role, kind, parentId, turnId, turnCompletedAt } = row as Message & { turnId?: string; turnCompletedAt?: number };
  return { id, at, role, kind, parentId, ...(turnId ? { turnId } : {}), ...(turnCompletedAt ? { turnCompletedAt } : {}),
    // At most four UTF-8 bytes a character: a quarter of the limit in characters stays under it.
    text: `${(row.text ?? "").slice(0, CHAT_ROW_MAX / 4)}${SHORTENED}` } as Message;
}

const taskOf = (bot: BotRecord, threadId: string): TaskRecord | null => (bot.tasks ?? []).find((task) => task.threadId === threadId) ?? null;
/** What a task carries to My Cloud: never this computer's turn state. */
function sentTask(task: TaskRecord): TaskRecord {
  const { busy: _busy, activity: _activity, turnStartedAt: _started, resumeCursors: _cursors, ...kept } = task as TaskRecord & Record<string, unknown>;
  return kept as unknown as TaskRecord;
}
const pick = <T extends object>(source: T, keys: readonly string[]) => Object.fromEntries(keys.filter((key) => (source as Record<string, unknown>)[key] !== undefined)
  .map((key) => [key, (source as Record<string, unknown>)[key]]));
/** What a room's thread carries to My Cloud: never this computer's folders. */
const sentRoomTask = (task: GroupTaskRecord) => pick(task, ["threadId", "title", "createdAt", "titleFromFirstMessage", "pinned", "pinnedMessageId"]) as unknown as GroupTaskRecord;
const sentRoom = (room: GroupRecord) => pick(room, ["name", "memberIds", "defaultResponder", "bulletin", "section", "setupCompletedAt", "setupSkippedAt"]) as unknown as SentRoom;

const messageSchema = z.object({ id: z.string().min(1).max(200), at: z.number().finite() }).passthrough();
const sentSchema = z.object({
  v: z.literal(1),
  dataDir: z.string().min(1).max(4096),
  conversations: z.array(z.object({
    bot: z.string().regex(/^[\w-]{1,128}$/u).optional(),
    room: z.string().regex(/^[\w-]{1,128}$/u).optional(),
    roomInfo: z.object({ name: z.string().min(1).max(100), memberIds: z.array(z.string().max(128)).max(200), bulletin: z.string().max(12_000) }).passthrough().optional(),
    threadId: z.string().regex(/^[\w-]{1,200}$/u),
    task: z.object({ threadId: z.string(), createdAt: z.number().finite() }).passthrough().nullable(),
    rows: z.array(messageSchema).max(CHAT_ROWS_PAGE * 4),
    leaf: z.string().max(200).nullable(),
    sent: z.boolean(),
  }).refine((entry) => (entry.bot === undefined) !== (entry.room === undefined))).max(200),
});

/** The request's bytes, or null past `limit` (read to the end either way, so the answer still reaches the sender). */
function rawBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes <= limit) chunks.push(chunk); });
    req.on("end", () => resolve(bytes > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export interface CloudSendChatsDeps {
  store: ChatStore & { bots: BotRecord[] };
  dataDir: string;
}

/** A conversation's rows after a point, a page at a time, as main sends them on; null when no bot or room here has it. */
export function chatPage({ store, dataDir }: CloudSendChatsDeps, threadId: string, after: number, afterId: string | null) {
  const bot = store.bots.find((candidate) => candidate.threadId === threadId || (candidate.tasks ?? []).some((task) => task.threadId === threadId));
  const room = bot ? undefined : store.groups.find((candidate) => roomThreads(candidate).includes(threadId));
  if ((!bot && !room) || !Number.isSafeInteger(after) || after < 0) return null;
  const path = activePath(store.messagesFor(threadId), store.activeLeaf(threadId)).map((row) => row.id);
  const page = threadRowsAfter(threadId, after, afterId, CHAT_ROWS_PAGE, CHAT_PAGE_BYTES, path);
  const task = bot ? taskOf(bot, threadId) : room!.tasks?.find((candidate) => candidate.threadId === threadId) ?? null;
  const owner = bot ? { bot: bot.id, task: task ? sentTask(task as TaskRecord) : null }
    : { room: room!.id, roomInfo: sentRoom(room!), task: task ? sentRoomTask(task as GroupTaskRecord) : null };
  return { v: 1, ...owner, threadId, ...page, rows: page.rows.map(fittedRow),
    attachments: [...new Set(page.rows.flatMap((row) => attachmentNames(row as Message, dataDir)))] };
}

/** False when the path is not one of these routes. */
export async function cloudSendChatsRoute(deps: CloudSendChatsDeps, { req, res, path, method, url, json, readBody }: RouteContext): Promise<boolean> {
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  res.setHeader("cache-control", "no-store");
  const { store } = deps;
  // This computer's side: what each conversation has, and its rows after a point.
  if (path === PREFIX && method === "GET") {
    json(res, 200, { v: 1, dataDir: deps.dataDir, conversations: chatHeads(store.bots, store.groups) });
    return true;
  }
  if (path === `${PREFIX}/rows` && method === "GET") {
    const page = chatPage(deps, url.searchParams.get("thread") ?? "", Number(url.searchParams.get("after") ?? 0), url.searchParams.get("id"));
    if (!page) json(res, 404, { error: "no such conversation" });
    else json(res, 200, page);
    return true;
  }
  const named = /^\/api\/cloud-send\/chats\/attachment\/([^/]+)$/u.exec(path)?.[1];
  if (named !== undefined) {
    if (!ATTACHMENT_NAME.test(named)) { json(res, 404, { error: "no such attachment" }); return true; }
    const file = join(ATTACHMENTS_DIR, named);
    if (method === "GET") {
      const stat = await lstat(file).catch(() => null);
      if (!stat?.isFile() || stat.size > FILE_MAX_BYTES) { json(res, 404, { error: "no such attachment" }); return true; }
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(stat.size) });
      res.end(await readFile(file));
      return true;
    }
    // My Cloud's side: an attachment a sent row names, kept under its own name; one already here is the same upload.
    if (method === "POST") {
      const bytes = await rawBody(req, FILE_MAX_BYTES);
      if (!bytes) { json(res, 413, { error: `attachments are limited to ${FILE_MAX_BYTES} bytes` }); return true; }
      await mkdir(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });
      // Written whole under a name of its own, then linked: the attachment's name never shows a partial file.
      const partial = join(ATTACHMENTS_DIR, `.sent-${randomUUID()}.partial`);
      await writeFile(partial, bytes, { flag: "wx", mode: 0o600 });
      try { await link(partial, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        json(res, 200, { stored: false });
        return true;
      } finally { await unlink(partial).catch(() => {}); }
      json(res, 201, { stored: true });
      return true;
    }
    json(res, 405, { error: "method not allowed" });
    return true;
  }
  if (path === `${PREFIX}/attachments` && method === "POST") {
    const body = z.object({ names: z.array(z.string()).max(2000) }).safeParse(await readBody(req, 256 * 1024));
    if (!body.success) { json(res, 400, { error: "send { names }" }); return true; }
    const missing: string[] = [];
    for (const name of new Set(body.data.names)) {
      if (!ATTACHMENT_NAME.test(name)) continue;
      const handle = await open(join(ATTACHMENTS_DIR, name), "r").catch(() => null);
      if (handle) await handle.close(); else missing.push(name);
    }
    json(res, 200, { missing });
    return true;
  }
  if (path === PREFIX && method === "POST") {
    const parsed = sentSchema.safeParse(await readBody(req, CHATS_BODY_MAX));
    if (!parsed.success) { json(res, 400, { error: "send { v: 1, dataDir, conversations }" }); return true; }
    const busy = new Set<string>();
    for (const bot of store.bots) {
      if (bot.busy) busy.add(bot.threadId);
      for (const task of bot.tasks ?? []) if (task.busy) busy.add(task.threadId);
    }
    for (const room of store.groups) if (room.busyBotId) for (const threadId of [room.threadId, ...(room.tasks ?? []).map((task) => task.threadId)]) busy.add(threadId);
    const result = addSentChats(store, deps.dataDir, parsed.data.dataDir, parsed.data.conversations as unknown as SentConversation[],
      { busy: (threadId) => busy.has(threadId) });
    json(res, 200, result);
    return true;
  }
  json(res, 405, { error: "method not allowed" });
  return true;
}
