// GET /api/cloud-send/manifest: everything of the person's this server holds that a move carries, by id with a
// fingerprint per kind, on this computer and on their Cloud alike, so the desktop can check that a move carried it all.
// Read only, never a secret: credentials are named here and checked by fingerprint (cloud-send-verify.ts).
import { attachmentNames, type ChatStore } from "./cloud-chat-merge.ts";
import { chatHeads } from "./cloud-send-chats.ts";
import type { CloudSendSummary } from "./cloud-send.ts";
import { hashMemoryText, memoryOverview, readMemoryDoc } from "./memory-store.ts";
import type { BotRecord } from "./store.ts";
import { readMemoryFile } from "./workspace.ts";

export interface ManifestConversation { threadId: string; bot?: string; room?: string; rows: number; newest: string }

export interface CloudSendManifest {
  v: 1;
  appVersion: string;
  /** Bots, skills, logins, 1Password and settings, as Send to My Cloud compares them (cloud-send.ts). */
  items: CloudSendSummary["items"];
  memory: Array<{ bot: string; path: string; hash: string }>;
  rooms: Array<{ id: string; name: string; members: string[]; threads: string[] }>;
  /** "mcp:<name>", "key:<provider>", "composio" or "highlevel". */
  connections: string[];
  conversations: ManifestConversation[];
  /** The stored attachments the conversations' rows name. */
  attachments: string[];
}

export interface ManifestSources {
  summary(): CloudSendSummary;
  store: ChatStore & { bots: BotRecord[] };
  dataDir: string;
  connections(): Promise<ReadonlyArray<{ id: string }>>;
  /** Each conversation's stored rows and its newest. */
  heads(): Map<string, { lastId: string; rows: number }>;
}

/** A bot's memory notes with words in them: its index and each topic and daily log. */
function memoryOf(botId: string): CloudSendManifest["memory"] {
  const out: CloudSendManifest["memory"] = [];
  const index = readMemoryFile(botId).text;
  if (index.trim()) out.push({ bot: botId, path: "MEMORY.md", hash: hashMemoryText(index) });
  let overview;
  try { overview = memoryOverview(botId); } catch { return out; }
  for (const file of [...overview.topics, ...overview.logs]) {
    const doc = readMemoryDoc(botId, file.path);
    if (doc.exists && doc.text.trim()) out.push({ bot: botId, path: file.path, hash: doc.hash });
  }
  return out;
}

export async function cloudSendManifest(sources: ManifestSources): Promise<CloudSendManifest> {
  const summary = sources.summary();
  const { store } = sources;
  const sent = new Set(summary.items.filter((item) => item.kind === "bot" && item.id).map((item) => item.id!));
  const rooms = store.groups.filter((room) => !room.dm);
  const counts = sources.heads();
  const conversations: ManifestConversation[] = chatHeads(store.bots, rooms).map((head) => ({
    threadId: head.threadId, ...(head.bot ? { bot: head.bot } : { room: head.room }), rows: counts.get(head.threadId)?.rows ?? 0, newest: head.lastId,
  }));
  const attachments = new Set<string>();
  for (const { threadId } of conversations) for (const row of store.messagesFor(threadId)) for (const name of attachmentNames(row, sources.dataDir)) attachments.add(name);
  return {
    v: 1,
    appVersion: summary.appVersion,
    items: summary.items,
    memory: [...sent].flatMap(memoryOf),
    rooms: rooms.map((room) => ({ id: room.id, name: room.name, members: [...room.memberIds].sort(),
      threads: room.tasks?.length ? room.tasks.map((task) => task.threadId) : [room.threadId] })),
    connections: (await sources.connections()).map((item) => item.id).sort(),
    conversations,
    attachments: [...attachments].sort(),
  };
}
