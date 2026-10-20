// What a move to the person's own Cloud checks once it has run, from both servers' own answers and never a secret:
// the two manifests (GET /api/cloud-send/manifest), each conversation's rows, its owner's lines and its visible path
// (this computer's /api/cloud-send/chats/ids against My Cloud's /chats/verify), the attachments the rows name, and each
// credential's fingerprint under a fresh nonce (this computer's private port against My Cloud's /verify-secrets).
import { randomBytes } from "node:crypto";
import { EMPTY } from "./cloud-send-parts.mjs";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
/** As many of a conversation's row ids, and of its path, as My Cloud checks at once. */
const IDS = 5_000;
const ATTACHMENT_NAMES = 2_000;
const THREAD = /^[\w-]{1,200}$/u;

/**
 * What of this computer's manifest My Cloud's lacks: items, memory notes, rooms, connections and conversations it
 * does not have, and parts of items it holds otherwise than it took them. A part counts as carried when it is equal on
 * both sides or is what My Cloud held right after it took it (`sent`, as cloud-send.mjs keeps it). Left out: what was
 * removed on My Cloud (`removed`, by key or conversation id), and what this computer never sends (`skip`).
 */
export function manifestGaps(here, there, { sent = {}, removed = new Set(), skip = new Set() } = {}) {
  const gaps = { items: [], parts: [], memory: [], rooms: [], connections: [], conversations: [] };
  if (!record(here) || !record(there)) return null;
  const theirs = new Map(list(there.items).map((item) => [item.key, item]));
  const bots = new Set();
  for (const item of list(here.items)) {
    if (removed.has(item.key) || skip.has(item.key) || (item.bot && (removed.has(`bot:${item.bot}`) || skip.has(`bot:${item.bot}`)))) continue;
    if (item.kind === "bot") bots.add(item.id);
    const on = theirs.get(item.key);
    if (!on) { gaps.items.push({ key: item.key, kind: item.kind, label: item.label }); continue; }
    // Logins and 1Password are compared by their secrets' fingerprints, never by when they changed.
    if (item.kind === "login" || item.kind === "1password") continue;
    const differs = Object.entries(item.parts ?? {}).filter(([part, hash]) => {
      const cloud = on.parts?.[part] ?? EMPTY;
      const pair = sent[item.key]?.[part];
      return hash !== cloud && !(Array.isArray(pair) && pair[0] === hash && pair[1] === cloud);
    }).map(([part]) => part);
    if (differs.length) gaps.parts.push({ key: item.key, label: item.label, parts: differs });
  }
  const notes = new Map(list(there.memory).map((note) => [`${note.bot}/${note.path}`, note.hash]));
  for (const note of list(here.memory)) if (bots.has(note.bot) && notes.get(`${note.bot}/${note.path}`) !== note.hash) gaps.memory.push({ bot: note.bot, path: note.path });
  const rooms = new Set(list(there.rooms).map((room) => room.id));
  for (const room of list(here.rooms)) if (!removed.has(`room:${room.id}`) && !rooms.has(room.id)) gaps.rooms.push({ id: room.id, name: room.name });
  const connections = new Set(list(there.connections));
  for (const id of list(here.connections)) if (!skip.has(id) && !connections.has(id)) gaps.connections.push(id);
  const conversations = new Set(list(there.conversations).map((head) => head.threadId));
  for (const head of list(here.conversations)) {
    if (removed.has(head.threadId) || (head.bot && !bots.has(head.bot)) || (head.room && removed.has(`room:${head.room}`))) continue;
    if (!conversations.has(head.threadId)) gaps.conversations.push(head.threadId);
  }
  return gaps;
}

export const noGaps = (gaps) => Boolean(gaps) && Object.values(gaps).every((entries) => entries.length === 0);

/** A conversation's row ids on this computer, and its visible path's, a chunk at a time. */
export async function* rowIdChunks(localJson, threadId) {
  for (let from = 0, more = true; more; from += IDS) {
    const page = await localJson(`/api/cloud-send/chats/ids?thread=${threadId}&from=${from}`);
    if (!record(page)) throw new Error("OpenMausBot on this computer did not list a conversation's rows.");
    more = page.more === true;
    yield { ids: list(page.ids), path: list(page.path), leaf: page.leaf ?? null, more };
  }
}

/**
 * Each conversation's rows and visible path checked on My Cloud, a chunk at a time, ids only: `missing`, the rows My
 * Cloud lacks; `unstamped`, the lines of its owner's it holds that do not carry the owner yet; `path`: "equal" when My
 * Cloud shows exactly this computer's path, "inside" when this computer's path appears in order inside a longer one of
 * My Cloud's (both sides added to it), "broken" otherwise.
 */
export async function checkChats({ localJson, session, threads }) {
  const out = [];
  for (const threadId of threads.filter((id) => THREAD.test(id))) {
    let missing = 0, unstamped = 0, after = null, holds = true, cloud = null, localLeaf = null, length = 0;
    for await (const chunk of rowIdChunks(localJson, threadId)) {
      localLeaf = chunk.leaf ?? localLeaf;
      length += chunk.path.length;
      const asked = { threadId, ids: chunk.ids, ...(holds ? { path: { after, ids: chunk.path, last: !chunk.more } } : {}) };
      const answer = await session.call("POST", "/api/cloud-send/chats/verify", { v: 1, conversations: [asked] });
      const checked = answer.ok ? list(answer.body?.conversations).find((entry) => entry?.threadId === threadId) : null;
      if (!checked) throw Object.assign(new Error("My Cloud did not check the chats."), { status: answer.status });
      missing += list(checked.missing).length;
      unstamped += Number.isSafeInteger(checked.unstamped) ? checked.unstamped : 0;
      if (asked.path) {
        holds = checked.path?.holds === true;
        after = checked.path?.at ?? null;
        if (!chunk.more) cloud = checked.path;
      }
    }
    const path = !holds ? "broken" : cloud && cloud.leaf === localLeaf && cloud.length === length ? "equal" : "inside";
    out.push({ threadId, missing, unstamped, path });
  }
  return out;
}

/** A move's check passes when nothing is missing: no gap, every conversation's rows there on a path that holds with
 * each line of the owner's carrying them, and every attachment and credential there as it is here. */
export const checkPassed = ({ gaps, chats, attachments, secrets }) => noGaps(gaps)
  && chats.every((thread) => !thread.missing && !thread.unstamped && thread.path !== "broken")
  && !attachments.length && !secrets.differs.length && !secrets.missing.length;

/** The attachments of `names` My Cloud lacks. */
export async function missingAttachments(session, names) {
  const missing = [];
  for (let i = 0; i < names.length; i += ATTACHMENT_NAMES) {
    const asked = names.slice(i, i + ATTACHMENT_NAMES);
    const answer = await session.call("POST", "/api/cloud-send/chats/attachments", { names: asked });
    if (!answer.ok) throw Object.assign(new Error("My Cloud did not check the attachments."), { status: answer.status });
    missing.push(...list(answer.body?.missing).filter((name) => asked.includes(name)));
  }
  return missing;
}

/** Each of this computer's credentials, by id, as `equal`, `differs` (My Cloud holds another value) or `missing` there:
 * their fingerprints under one fresh nonce on both sides, so nothing secret travels. */
export async function checkSecrets({ handoff, session, skip = new Set(), nonce = randomBytes(32).toString("base64url") }) {
  const here = (await handoff({ kind: "verify-secrets", nonce }))?.secrets;
  const answer = await session.call("POST", "/api/cloud-send/verify-secrets", { nonce });
  const there = answer.ok ? answer.body?.secrets : null;
  if (!record(here) || !record(there)) throw Object.assign(new Error("The credentials could not be checked."), { status: answer.status });
  const out = { equal: [], differs: [], missing: [] };
  for (const [id, value] of Object.entries(here)) {
    if (skip.has(id)) continue;
    out[typeof there[id] !== "string" ? "missing" : there[id] === value ? "equal" : "differs"].push(id);
  }
  return out;
}
