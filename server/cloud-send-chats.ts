// Keep My Cloud up to date's chats, by row, never as a copy. This computer lists each bot conversation's newest stored
// row (GET /api/cloud-send/chats) and hands main the rows stored after the last one My Cloud took (GET
// /api/cloud-send/chats/rows); My Cloud adds them as Bring newer chats adds a copy's (cloud-chat-merge.ts): only what it
// lacks, never replacing or deleting anything. A conversation's history therefore goes once, and then only what is new.
// Admin scope (request-auth's default) on both sides.
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { z } from "zod";

import { ATTACHMENTS_DIR, FILE_MAX_BYTES } from "./attachments.ts";
import { addSentChats, attachmentNames, ATTACHMENT_NAME, type ChatStore, type SentConversation } from "./cloud-chat-merge.ts";
import { chatsSyncedAt } from "./cloud-move.ts";
import { threadHeads, threadRowsAfter } from "./message-db.ts";
import type { RouteContext } from "./routes/table.ts";
import type { BotRecord, Message, TaskRecord } from "./store.ts";

export const CHAT_ROWS_PAGE = 300;
/** A batch main sends at once: rows of a few conversations, well under the body limit. */
export const CHATS_BODY_MAX = 8 * 1024 * 1024;
const PREFIX = "/api/cloud-send/chats";

export interface ChatHead { bot: string; threadId: string; last: number; lastId: string; busy: boolean }

/** Every bot conversation with stored rows: its newest row, and whether its bot is answering in it now. */
export function chatHeads(bots: readonly BotRecord[], heads = threadHeads()): ChatHead[] {
  const out: ChatHead[] = [];
  for (const bot of bots) {
    const conversations = [{ threadId: bot.threadId, busy: Boolean(bot.busy) }, ...(bot.tasks ?? []).map((task) => ({ threadId: task.threadId, busy: Boolean(task.busy) }))];
    const seen = new Set<string>();
    for (const { threadId, busy } of conversations) {
      const head = heads.get(threadId);
      if (!head || seen.has(threadId)) continue;
      seen.add(threadId);
      out.push({ bot: bot.id, threadId, last: head.last, lastId: head.lastId, busy });
    }
  }
  return out;
}

const taskOf = (bot: BotRecord, threadId: string): TaskRecord | null => (bot.tasks ?? []).find((task) => task.threadId === threadId) ?? null;
/** What a task carries to My Cloud: never this computer's turn state. */
function sentTask(task: TaskRecord): TaskRecord {
  const { busy: _busy, activity: _activity, turnStartedAt: _started, resumeCursors: _cursors, ...kept } = task as TaskRecord & Record<string, unknown>;
  return kept as unknown as TaskRecord;
}

const messageSchema = z.object({ id: z.string().min(1).max(200), at: z.number().finite() }).passthrough();
const sentSchema = z.object({
  v: z.literal(1),
  dataDir: z.string().min(1).max(4096),
  conversations: z.array(z.object({
    bot: z.string().regex(/^[\w-]{1,128}$/u),
    threadId: z.string().regex(/^[\w-]{1,200}$/u),
    task: z.object({ threadId: z.string(), createdAt: z.number().finite() }).passthrough().nullable(),
    rows: z.array(messageSchema).max(CHAT_ROWS_PAGE * 4),
    leaf: z.string().max(200).nullable(),
    sent: z.boolean(),
  })).max(200),
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

/** False when the path is not one of these routes. */
export async function cloudSendChatsRoute(deps: CloudSendChatsDeps, { req, res, path, method, url, json, readBody }: RouteContext): Promise<boolean> {
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  res.setHeader("cache-control", "no-store");
  const { store } = deps;
  // This computer's side: what each conversation has, and its rows after a point.
  if (path === PREFIX && method === "GET") {
    json(res, 200, { v: 1, dataDir: deps.dataDir, conversations: chatHeads(store.bots) });
    return true;
  }
  if (path === `${PREFIX}/rows` && method === "GET") {
    const threadId = url.searchParams.get("thread") ?? "";
    const after = Number(url.searchParams.get("after") ?? 0);
    const bot = store.bots.find((candidate) => candidate.threadId === threadId || (candidate.tasks ?? []).some((task) => task.threadId === threadId));
    if (!bot || !Number.isSafeInteger(after) || after < 0) { json(res, 404, { error: "no such conversation" }); return true; }
    const page = threadRowsAfter(threadId, after, url.searchParams.get("id"), CHAT_ROWS_PAGE);
    const task = taskOf(bot, threadId);
    json(res, 200, { v: 1, bot: bot.id, threadId, task: task ? sentTask(task) : null, ...page,
      attachments: [...new Set(page.rows.flatMap((row) => attachmentNames(row as Message, deps.dataDir)))] });
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
      try { await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        json(res, 200, { stored: false });
        return true;
      }
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
    const result = addSentChats(store, deps.dataDir, parsed.data.dataDir, parsed.data.conversations as unknown as SentConversation[],
      { busy: (threadId) => busy.has(threadId), syncedAt: chatsSyncedAt(deps.dataDir) });
    json(res, 200, result);
    return true;
  }
  json(res, 405, { error: "method not allowed" });
  return true;
}
