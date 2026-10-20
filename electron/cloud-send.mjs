// Send to My Cloud: this computer's bots, their skills, logins, 1Password, settings and chats go to the person's own
// Cloud. One direction; added and updated, never deleted; one action for every entry point and for "Keep My Cloud up to
// date", which also makes the first send to a Cloud by itself. Chats go by row (server/cloud-send-chats.ts): each
// conversation's rows after the last one My Cloud took, so its history goes once. A Cloud too old for that gets Bring
// newer chats' copy, only from a send the person asked for or the first one.
//
// What each side has comes from both servers' GET /api/cloud-send; what goes is decided part by part (planSend in
// cloud-send-parts.mjs). Every write is one of My Cloud's own routes, over one owner session per send: the Admin's
// one-time code for the Cloud it verified, redeemed at that Cloud alone, signed out after, as Copy does. A secret reaches
// main only over the server's private port (server/login-handoff.ts) and goes only to that session.
import { createHash } from "node:crypto";
import { BOT_PARTS, EMPTY, PICTURE_PART, differenceSignature, failedSummary, itemKey, parseSendSummary, pendingRows, planSend, resultKey } from "./cloud-send-parts.mjs";
import { botsOnCloud } from "./cloud-logins.mjs";

const LOCAL_ROUTE = /^\/api\/(?:cloud-send|cloud-send\/chats|cloud-send\/chats\/rows\?thread=[\w-]{1,200}&after=\d{1,16}&id=[\w%.-]{0,600}|cloud-send\/chats\/attachment\/[A-Za-z0-9-]{1,80}\.[A-Za-z0-9]{1,10}|config|bots\?messages=0|bots\/[\w-]{1,128}\/(?:skills|skills\/[a-z0-9-]{1,64}|memory|memory\/file\?path=[\w%.-]{1,200})|attachments\/[A-Za-z0-9-]{1,80}\.(?:png|jpg|gif|webp))$/u;
const AUTO_FIRST_MS = 20_000;
const AUTO_EVERY_MS = 2 * 60_000;
const AUTO_FULL_MS = 30 * 60_000;
/** Chats alone go at most this often: each send is one sign-in at My Cloud, which the Admin limits. */
const CHATS_EVERY_MS = 5 * 60_000;
/** One request's chats: a few conversations' rows, well under My Cloud's body limit. */
const CHATS_BATCH_BYTES = 4 * 1024 * 1024;
const CHATS_BATCH_PAGES = 40;
/** My Cloud checks at most this many attachment names a request. */
const ATTACHMENT_NAMES = 2000;
const MEMORY_FILES = 100;
const PICTURE_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const VAULT_ID = /^[\w-]{1,128}$/u;
/** Whole sends, which carry the chats too; a send of some items (Use this computer's, one login) never does. */
const CHAT_REASONS = new Set(["button", "my-cloud", "menu", "auto", "first"]);
/** Bring newer chats' copy of the whole workspace: never for the background send. */
const BRING_REASONS = new Set(["button", "my-cloud", "menu", "first"]);

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sentence = (value) => (typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, 300) : null);

export class CloudSendError extends Error {
  constructor(code, message) { super(message); this.name = "CloudSendError"; this.code = code; }
}

/** One plain sentence for a failed write, from what My Cloud answered. */
function refusal(answer, fallback) {
  if (answer.status === 401 || answer.status === 403) return "My Cloud did not let this app make the change. Open My Cloud in this app once, then try again.";
  if (answer.status === 409 && /limited to \d+ bots/u.test(answer.body?.error ?? "")) return sentence(answer.body.error);
  return sentence(answer.body?.error) ? `My Cloud said: ${sentence(answer.body.error)}` : fallback;
}

/** My Cloud's own 1Password refusal speaks to someone pasting a token on My Cloud's page; here it was this computer's.
 * 1Password refusing the token is final: sending it again can't help until 1Password is connected again here. */
function onePasswordRefusal(answer) {
  const said = sentence(answer.body?.error);
  if (answer.status === 400 && said && /did not accept the token|not a whole 1Password|service account token/iu.test(said)) {
    return Object.assign(new CloudSendError("refused", "My Cloud's 1Password did not accept this computer's token: it may have been revoked, expired, or lost access to its vault. Connect 1Password again in this computer's Settings → Logins, and it goes to My Cloud by itself."), { final: true });
  }
  return new CloudSendError("refused", refusal(answer, "My Cloud could not connect 1Password."));
}

const pick = (source, names) => Object.fromEntries(names.filter((name) => source[name] !== undefined && source[name] !== null).map((name) => [name, source[name]]));

/** A bot's fields for some parts, as My Cloud's PATCH takes them: nothing that names this computer's other bots unless
 * My Cloud has them, and never Custom approval, which only this computer's own window can grant. */
export function botPatch(bot, parts, cloudBots) {
  const body = {};
  for (const part of parts) {
    const names = BOT_PARTS[part];
    if (names) Object.assign(body, pick(bot, names));
  }
  if (body.approvalMode === "custom") delete body.approvalMode;
  if (Array.isArray(body.peers)) body.peers = body.peers.filter((id) => cloudBots.has(id));
  if (record(body.modelSelection)) body.modelSelection = pick(body.modelSelection, ["instanceId", "model", "effort", "variant"]);
  if (parts.includes("model") && record(body.modelSelection)) body.requireAvailableModel = true;
  return body;
}

/** The state main keeps in its own folder: the switch, and per Cloud what was sent and what the person kept here. */
export function parseSendState(value) {
  const clouds = {};
  if (record(value?.clouds)) {
    for (const [origin, entry] of Object.entries(value.clouds)) {
      if (!/^https?:\/\/[^/\s]+$/u.test(origin) || !record(entry)) continue;
      clouds[origin] = {
        sent: record(entry.sent) ? entry.sent : {},
        off: record(entry.off) ? Object.fromEntries(Object.entries(entry.off).filter(([, why]) => why === "you" || why === "removed")) : {},
        dismissed: typeof entry.dismissed === "string" ? entry.dismissed : "",
        last: record(entry.last) && Number.isSafeInteger(entry.last.at) && record(entry.last.result) ? entry.last : null,
        chats: record(entry.chats) ? Object.fromEntries(Object.entries(entry.chats).filter(([threadId, cursor]) => /^[\w-]{1,200}$/u.test(threadId)
          && (cursor === "removed" || (record(cursor) && Number.isSafeInteger(cursor.after) && typeof cursor.id === "string")))) : {},
      };
    }
  }
  return { v: 1, auto: value?.auto !== false, clouds };
}

/** What My Cloud's own page is told: the names of this computer's bots that wait, and counts. */
export function sendNotice(snapshot) {
  const rows = pendingRows({ rows: snapshot.rows ?? [] });
  const count = (kind) => rows.filter((row) => row.kind === kind).length;
  return {
    ready: snapshot.cloud === "ready",
    // Keep My Cloud up to date: everything comes over by itself, so My Cloud's welcome has nothing to offer for it.
    auto: snapshot.auto !== false,
    bots: rows.filter((row) => row.kind === "bot" && row.state === "only-here").map((row) => row.label),
    updatedBots: rows.filter((row) => row.kind === "bot" && row.state === "to-update").map((row) => row.label),
    skills: count("skill"), logins: count("login"), onePassword: count("1password") > 0, settings: count("setting"),
    signature: snapshot.signature ?? "",
    dismissed: Boolean(snapshot.signature) && snapshot.signature === snapshot.dismissed,
    running: Boolean(snapshot.running),
    ...(snapshot.running ? { runningReason: snapshot.running.reason, ...(snapshot.running.progress ? { progress: snapshot.running.progress } : {}),
      ...(snapshot.running.phase ? { phase: snapshot.running.phase } : {}) } : {}),
    last: snapshot.last ? { at: snapshot.last.at, reason: snapshot.last.reason, failed: snapshot.last.result.failed.length, sent: sentCounts(snapshot.last.result),
      // Every failure is one trying again can't fix (1Password refused the token): no Try again.
      final: !snapshot.last.error && snapshot.last.result.failed.length > 0 && snapshot.last.result.failed.every((entry) => entry.final === true),
      seen: snapshot.dismissed === resultKey(snapshot.last), ...failedSummary(snapshot.last) } : null,
  };
}

/** What a send got across, in counts only: My Cloud's page names nothing of this computer's but its bots. */
function sentCounts(result) {
  return { bots: result.bots.length, updatedBots: result.updatedBots.length, skills: result.skills, logins: result.logins, onePassword: result.onePassword,
    settings: result.settings.length, chats: result.chats ?? null };
}

/** What a send did, in counts and the names a person recognises. */
function emptyResult() {
  return { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, failed: [], notes: [] };
}

/**
 * @param {{
 *   local: (route: string) => Promise<Response>,
 *   cloud: {
 *     origin(): string | null,
 *     asleep(): boolean,
 *     read(route: string): Promise<Response>,
 *     open(): Promise<{ call(method: string, route: string, body?: unknown): Promise<{ status: number, ok: boolean, body: any }>,
 *       upload(route: string, bytes: Uint8Array, type: string): Promise<{ status: number, ok: boolean, body: any }>, close(): Promise<void> }>,
 *   },
 *   handoff: (what: { kind: "login", id: string } | { kind: "1password" }) => Promise<{ login?: Record<string, any>, onePassword?: { token: string, grants: Record<string, unknown> } }>,
 *   bringChats?: () => Promise<{ conversations: number, messages: number }>,
 *   store: { read(): unknown, write(value: unknown): void },
 *   onChange?: (snapshot: unknown) => void,
 *   now?: () => number,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 * }} deps
 */
export function createCloudSend({ local, cloud, handoff, bringChats = null, store, onChange = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let saved = parseSendState(safeRead(store));
  let view = { cloud: "none", plan: null, local: null, theirs: null };
  let running = null, progress = null, timer = null, stopped = true;
  let autoDigest = "", autoAt = 0, autoFailedDigest = "", autoFailedAt = 0, chatsAt = 0;

  function safeRead(source) { try { return source.read(); } catch { return null; } }
  function persist() { try { store.write(saved); } catch {} }
  const entry = (origin) => (saved.clouds[origin] ??= { sent: {}, off: {}, dismissed: "", last: null, chats: {} });

  function snapshot() {
    const origin = cloud.origin();
    const mine = origin ? entry(origin) : null;
    const plan = view.plan;
    return {
      cloud: origin ? view.cloud : "none",
      auto: saved.auto,
      running: running ? { reason: running.reason, ...(progress ? { progress } : {}), ...(running.chats ? { phase: "chats" } : {}) } : null,
      rows: plan?.rows ?? [],
      cloudOnly: plan?.cloudOnly ?? [],
      pending: plan ? pendingRows(plan).length : 0,
      signature: plan && pendingRows(plan).length ? createHash("sha256").update(differenceSignature(plan)).digest("hex").slice(0, 32) : "",
      dismissed: mine?.dismissed ?? "",
      last: mine?.last ?? null,
      cloudVersion: view.theirs?.appVersion ?? null,
      localVersion: view.local?.appVersion ?? null,
    };
  }
  const publish = () => { const value = snapshot(); try { onChange(value); } catch {} return value; };

  async function localJson(route) {
    if (!LOCAL_ROUTE.test(route)) throw new CloudSendError("invalid", "Unsupported local request.");
    const response = await local(route);
    if (!response.ok) throw new CloudSendError("local", "OpenMausBot on this computer did not answer. Try again in a moment.");
    return response.json();
  }
  async function localBytes(route) {
    if (!LOCAL_ROUTE.test(route)) throw new CloudSendError("invalid", "Unsupported local request.");
    const response = await local(route);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  }

  async function readCloud() {
    let response;
    try { response = await cloud.read("/api/cloud-send"); } catch { return { state: cloud.asleep() ? "asleep" : "unreachable" }; }
    if (response.status === 404) return { state: "outdated" };
    if (!response.ok) return { state: response.status === 401 || response.status === 403 ? "signed-out" : "unreachable" };
    const summary = parseSendSummary(await response.json().catch(() => null));
    return summary ? { state: "ready", summary } : { state: "unreachable" };
  }

  function plan(origin, mine, theirs, force = []) {
    const kept = entry(origin);
    const planned = planSend({ local: mine, cloud: theirs, sent: kept.sent, off: kept.off, force });
    let changed = false;
    for (const [key, parts] of Object.entries(planned.baseline)) { kept.sent[key] = { ...kept.sent[key], ...parts }; changed = true; }
    for (const key of planned.removed) { kept.off[key] = "removed"; delete kept.sent[key]; changed = true; }
    if (changed) persist();
    return planned;
  }

  /** Reads both sides and plans; never writes to My Cloud. */
  async function compare() {
    const origin = cloud.origin();
    if (!origin) { view = { cloud: "none", plan: null, local: null, theirs: null }; return publish(); }
    if (cloud.asleep()) { view = { ...view, cloud: "asleep" }; return publish(); }
    const [mine, theirs] = await Promise.all([localJson("/api/cloud-send").then(parseSendSummary).catch(() => null), readCloud()]);
    if (!mine) { view = { ...view, cloud: "local-unavailable" }; return publish(); }
    if (theirs.state !== "ready") { view = { cloud: theirs.state, plan: null, local: mine, theirs: null }; return publish(); }
    view = { cloud: "ready", plan: plan(origin, mine, theirs.summary), local: mine, theirs: theirs.summary };
    return publish();
  }

  /** One send at a time; one asked while another runs waits for it, then runs as it was asked. */
  async function send({ keys = null, force = [], reason = "button" } = {}) {
    while (running) await running.promise.catch(() => {});
    const origin = cloud.origin();
    if (!origin) throw new CloudSendError("no_cloud", "This computer has no My Cloud yet.");
    const job = { reason, promise: null, chats: false };
    running = job;
    progress = null;
    publish();
    job.promise = (async () => {
      try { return await sendTo(origin, job, { keys, force: Array.isArray(force) ? force.filter((key) => typeof key === "string") : [], reason }); }
      catch (error) {
        // Kept as this send's outcome, so the strip and Settings say why, instead of an earlier send's result.
        entry(origin).last = { at: now(), reason, result: emptyResult(), error: sentence(error?.message) ?? "Nothing could be sent to My Cloud. Try again." };
        persist();
        throw error;
      }
      finally { running = null; progress = null; publish(); }
    })();
    return job.promise;
  }

  async function sendTo(origin, job, { keys, force, reason }) {
    const result = emptyResult();
    const mine = parseSendSummary(await localJson("/api/cloud-send"));
    if (!mine) throw new CloudSendError("local", "OpenMausBot on this computer did not answer. Try again in a moment.");
    const withChats = !keys && CHAT_REASONS.has(reason);
    const latest = await sendItems(origin, mine, result, { keys, force, chatsFor: withChats ? job : null });
    // A Cloud too old to take rows: Bring newer chats, after the items' session is signed out, since it opens its own
    // for as long as the upload takes.
    if (withChats && !latest.chats && bringChats && BRING_REASONS.has(reason)) {
      job.chats = true;
      publish();
      try { result.chats = await bringChats(); }
      catch (error) { result.failed.push({ key: "chats", kind: "chats", label: "Chats", error: sentence(error?.message) ?? "The chats could not be added." }); }
    }
    if (withChats) chatsAt = now();
    const outcome = { at: now(), reason, result };
    entry(origin).last = outcome;
    persist();
    view = { cloud: "ready", plan: plan(origin, mine, latest), local: mine, theirs: latest };
    return outcome;
  }

  /** Every item that waits, and then the chats, over one owner session, always signed out; what My Cloud holds after. */
  async function sendItems(origin, mine, result, { keys, force, chatsFor }) {
    const session = await cloud.open().catch((error) => { throw new CloudSendError("session", sentence(error?.message) ?? "This app could not sign in to My Cloud. Try again."); });
    try {
      const before = await session.call("GET", "/api/cloud-send");
      if (before.status === 404) throw new CloudSendError("outdated", "My Cloud needs an update before it can receive bots from this computer. It updates by itself; try again later.");
      const theirs = before.ok ? parseSendSummary(before.body) : null;
      if (!theirs) throw new CloudSendError("unreachable", refusal(before, "My Cloud did not answer. Try again."));
      const planned = plan(origin, mine, theirs, force);
      const wanted = keys ? new Set(keys) : null;
      const rows = pendingRows(planned).filter((row) => !wanted || wanted.has(row.key) || (row.bot && wanted.has(itemKey.bot(row.bot))));
      const total = rows.length;
      progress = total ? { done: 0, total } : null;
      publish();
      const cloudBots = new Set(theirs.items.filter((item) => item.kind === "bot" && item.id).map((item) => item.id));
      const localItems = new Map(mine.items.map((item) => [item.key, item]));
      const cloudItems = new Map(theirs.items.map((item) => [item.key, item]));
      const ctx = { session, result, cloudBots, localItems, cloudItems, planned: new Map(planned.rows.map((row) => [row.key, row])), bots: null, skillLists: new Map(), sentKeys: new Set(), sentParts: {} };
      const order = { bot: 0, skill: 1, setting: 2, login: 3, "1password": 4 };
      for (const row of [...rows].sort((a, b) => order[a.kind] - order[b.kind])) {
        try { await sendRow(ctx, row); }
        catch (error) { result.failed.push({ key: row.key, kind: row.kind, label: row.label, error: sentence(error?.message) ?? "It could not be sent.", ...(error?.final === true ? { final: true } : {}) }); }
        if (progress) progress = { done: progress.done + 1, total };
        publish();
      }
      const after = parseSendSummary((await session.call("GET", "/api/cloud-send")).body);
      if (after) remember(origin, ctx, after);
      const latest = after ?? theirs;
      if (chatsFor && latest.chats) {
        chatsFor.chats = true;
        progress = null;
        publish();
        try { await sendChatRows(origin, session, latest, result); }
        catch (error) { result.failed.push({ key: "chats", kind: "chats", label: "Chats", error: sentence(error?.message) ?? "The chats could not be added." }); }
      }
      return latest;
    } finally {
      try { await session.close(); } catch {}
    }
  }

  /** The bot conversations whose newest row My Cloud has not taken: of bots My Cloud has, not kept here, not answering now. */
  async function chatsWaiting(origin, theirs) {
    const listed = await localJson("/api/cloud-send/chats");
    const kept = entry(origin);
    const cloudBots = new Set(theirs.items.filter((item) => item.kind === "bot" && item.id).map((item) => item.id));
    const conversations = (Array.isArray(listed?.conversations) ? listed.conversations : []).filter((head) => record(head)
      && typeof head.bot === "string" && typeof head.threadId === "string" && /^[\w-]{1,200}$/u.test(head.threadId) && Number.isSafeInteger(head.last) && typeof head.lastId === "string");
    const waiting = conversations.filter((head) => {
      const cursor = kept.chats[head.threadId];
      if (cursor === "removed" || !cloudBots.has(head.bot) || kept.off[itemKey.bot(head.bot)]) return false;
      return !cursor || cursor.after !== head.last || cursor.id !== head.lastId;
    });
    return { dataDir: typeof listed?.dataDir === "string" ? listed.dataDir : "", ready: waiting.filter((head) => !head.busy), busy: waiting.filter((head) => head.busy).length };
  }

  /** Each waiting conversation's new rows, page by page, a few conversations per request; the cursor moves only past
   * what My Cloud took, and once My Cloud did not take a page, the conversation's later pages wait for the next send too.
   * The attachments those rows name go first, unless My Cloud has them. */
  async function sendChatRows(origin, session, theirs, result) {
    const { dataDir, ready } = await chatsWaiting(origin, theirs);
    const kept = entry(origin);
    const total = ready.length;
    const held = new Set();
    let batch = [], bytes = 0, done = 0;
    result.chats = { conversations: 0, messages: 0 };
    progress = total ? { done: 0, total } : null;
    publish();
    const flush = async () => {
      if (!batch.length) return;
      const names = [...new Set(batch.flatMap((page) => page.attachments))];
      for (let i = 0; i < names.length; i += ATTACHMENT_NAMES) {
        const asked = names.slice(i, i + ATTACHMENT_NAMES);
        const checked = await session.call("POST", "/api/cloud-send/chats/attachments", { names: asked });
        if (!checked.ok) throw new CloudSendError("refused", refusal(checked, "My Cloud could not take the chats' attachments."));
        for (const name of Array.isArray(checked.body?.missing) ? checked.body.missing.filter((name) => asked.includes(name)) : []) {
          const file = await localBytes(`/api/cloud-send/chats/attachment/${name}`);
          if (!file) continue;
          const stored = await session.upload(`/api/cloud-send/chats/attachment/${name}`, file, "application/octet-stream");
          if (!stored.ok && stored.status !== 413) throw new CloudSendError("refused", refusal(stored, "My Cloud could not take an attachment of the chats."));
        }
      }
      const answer = await session.call("POST", "/api/cloud-send/chats", { v: 1, dataDir,
        conversations: batch.map(({ bot, threadId, task, rows, leaf, sent }) => ({ bot, threadId, task, rows, leaf, sent })) });
      if (!answer.ok) throw new CloudSendError("refused", refusal(answer, "My Cloud could not add the chats."));
      const accepted = new Set(Array.isArray(answer.body?.accepted) ? answer.body.accepted : []);
      const removed = new Set(Array.isArray(answer.body?.removed) ? answer.body.removed : []);
      for (const page of batch) {
        if (accepted.has(page.threadId) && page.lastId) kept.chats[page.threadId] = { after: page.last, id: page.lastId };
        else {
          held.add(page.threadId);
          if (removed.has(page.threadId) && page.sent) kept.chats[page.threadId] = "removed";
        }
      }
      result.chats.conversations += Number.isSafeInteger(answer.body?.conversations) ? answer.body.conversations : 0;
      result.chats.messages += Number.isSafeInteger(answer.body?.messages) ? answer.body.messages : 0;
      persist();
      batch = []; bytes = 0;
    };
    for (const head of ready) {
      let cursor = record(kept.chats[head.threadId]) ? kept.chats[head.threadId] : null;
      for (let pages = 0; pages < 10_000 && !held.has(head.threadId); pages++) {
        const page = await localJson(`/api/cloud-send/chats/rows?thread=${head.threadId}&after=${cursor?.after ?? 0}&id=${encodeURIComponent(cursor?.id ?? "")}`);
        if (!record(page) || !Array.isArray(page.rows)) break;
        if (page.restarted) delete kept.chats[head.threadId];
        if (page.rows.length) {
          const size = Buffer.byteLength(JSON.stringify(page.rows), "utf8");
          if (bytes + size > CHATS_BATCH_BYTES || batch.length >= CHATS_BATCH_PAGES) await flush();
          if (held.has(head.threadId)) break;
          batch.push({ bot: head.bot, threadId: head.threadId, task: record(page.task) ? page.task : null, rows: page.rows, leaf: typeof page.leaf === "string" ? page.leaf : null,
            sent: record(kept.chats[head.threadId]), last: page.last, lastId: page.lastId,
            attachments: Array.isArray(page.attachments) ? page.attachments.filter((name) => typeof name === "string" && /^[A-Za-z0-9-]{1,80}\.[A-Za-z0-9]{1,10}$/u.test(name)) : [] });
          bytes += size;
        } else if (page.lastId) kept.chats[head.threadId] = { after: page.last, id: page.lastId };
        if (!page.more || !page.lastId) break;
        cursor = { after: page.last, id: page.lastId };
      }
      progress = { done: ++done, total };
      publish();
    }
    await flush();
  }

  /** What was sent is recorded against what My Cloud holds right after, a part it refused included: that part is tried
   * again only once it changes here. */
  function remember(origin, ctx, after) {
    const kept = entry(origin);
    const there = new Map(after.items.map((item) => [item.key, item]));
    for (const key of ctx.sentKeys) {
      const mine = ctx.localItems.get(key), theirs = there.get(key);
      if (!mine || !theirs) continue;
      kept.sent[key] = { ...kept.sent[key] };
      for (const part of ctx.sentParts[key] ?? Object.keys(mine.parts)) kept.sent[key][part] = [mine.parts[part], theirs.parts[part] ?? EMPTY];
    }
  }

  const done = (ctx, key, parts = null) => { ctx.sentKeys.add(key); if (parts) ctx.sentParts[key] = parts; };

  async function localBots(ctx) {
    if (!ctx.bots) {
      const listed = await localJson("/api/bots?messages=0");
      ctx.bots = new Map((Array.isArray(listed?.bots) ? listed.bots : []).filter((bot) => record(bot) && typeof bot.id === "string").map((bot) => [bot.id, bot]));
    }
    return ctx.bots;
  }
  async function localSkills(ctx, botId) {
    if (!ctx.skillLists.has(botId)) {
      const listed = await localJson(`/api/bots/${botId}/skills`);
      ctx.skillLists.set(botId, new Map((Array.isArray(listed?.skills) ? listed.skills : []).filter((skill) => record(skill) && typeof skill.name === "string").map((skill) => [skill.name, skill])));
    }
    return ctx.skillLists.get(botId);
  }

  async function sendRow(ctx, row) {
    if (row.kind === "bot") return row.state === "only-here" ? addBot(ctx, row) : updateBot(ctx, row);
    if (row.kind === "skill") return sendSkill(ctx, row);
    if (row.kind === "setting") return sendSetting(ctx, row);
    if (row.kind === "login") return sendLogin(ctx, row);
    if (row.kind === "1password") return sendOnePassword(ctx, row);
  }

  async function patchBot(ctx, bot, parts) {
    const refused = {};
    const whole = await ctx.session.call("PATCH", `/api/bots/${bot.id}`, botPatch(bot, parts, ctx.cloudBots));
    if (whole.ok) return refused;
    for (const part of parts) {
      const body = botPatch(bot, [part], ctx.cloudBots);
      if (!Object.keys(body).length) continue;
      const one = await ctx.session.call("PATCH", `/api/bots/${bot.id}`, body);
      if (!one.ok) refused[part] = refusal(one, "My Cloud refused this setting.");
    }
    return refused;
  }

  async function sendPicture(ctx, bot) {
    const name = typeof bot.avatarUrl === "string" ? /^\/api\/attachments\/([A-Za-z0-9-]{1,80}\.(png|jpg|gif|webp))$/u.exec(bot.avatarUrl) : null;
    if (!name) return null;
    const bytes = await localBytes(`/api/attachments/${name[1]}`);
    if (!bytes) return "The picture could not be read on this computer.";
    const uploaded = await ctx.session.upload("/api/attachments", bytes, PICTURE_TYPES[name[2]]);
    const stored = typeof uploaded.body?.path === "string" ? uploaded.body.path.replaceAll("\\", "/").split("/").pop() : null;
    if (!uploaded.ok || !stored) return refusal(uploaded, "My Cloud could not store the picture.");
    const set = await ctx.session.call("PATCH", `/api/bots/${bot.id}`, { avatarUrl: `/api/attachments/${stored}` });
    return set.ok ? null : refusal(set, "My Cloud could not use the picture.");
  }

  async function addBot(ctx, row) {
    const bot = (await localBots(ctx)).get(row.id);
    if (!bot) throw new CloudSendError("gone", "This bot is no longer on this computer.");
    const model = record(bot.modelSelection) ? pick(bot.modelSelection, ["instanceId", "model", "effort", "variant"]) : null;
    const base = { id: bot.id, threadId: bot.threadId, name: bot.name, useDefaults: false };
    let created = await ctx.session.call("POST", "/api/bots", { ...base, ...(model ? { modelSelection: model, requireAvailableModel: true } : {}) });
    let modelKept = Boolean(model) && created.ok;
    if (!created.ok && model && created.status === 400) {
      created = await ctx.session.call("POST", "/api/bots", base);
      modelKept = false;
    }
    if (!created.ok) throw new CloudSendError("refused", refusal(created, "My Cloud could not add this bot."));
    ctx.cloudBots.add(bot.id);
    const parts = Object.keys(BOT_PARTS).filter((part) => part !== "name" && (part !== "model" || modelKept));
    const refused = await patchBot(ctx, bot, parts);
    const picture = await sendPicture(ctx, bot);
    if (picture) refused[PICTURE_PART] = picture;
    done(ctx, row.key);
    ctx.result.bots.push(bot.name);
    if ((!modelKept && model) || refused.model) ctx.result.notes.push({ kind: "model", bot: bot.name });
    if (Object.keys(refused).some((part) => part !== "model")) ctx.result.notes.push({ kind: "settings", bot: bot.name });
    for (const [key, item] of ctx.localItems) {
      if (item.kind !== "skill" || item.bot !== bot.id || ctx.planned.get(key)?.state !== "only-here") continue;
      try { await putSkill(ctx, bot.id, item.id, false); done(ctx, key); ctx.result.skills++; }
      catch (error) { ctx.result.failed.push({ key, kind: "skill", label: item.label, error: sentence(error?.message) ?? "It could not be sent." }); }
    }
    await sendMemory(ctx, bot.id).catch(() => ctx.result.notes.push({ kind: "memory", bot: bot.name }));
  }

  async function updateBot(ctx, row) {
    const bot = (await localBots(ctx)).get(row.id);
    if (!bot) throw new CloudSendError("gone", "This bot is no longer on this computer.");
    const parts = row.parts ?? [];
    const fields = parts.filter((part) => part !== PICTURE_PART);
    const refused = fields.length ? await patchBot(ctx, bot, fields) : {};
    if (parts.includes(PICTURE_PART)) {
      const picture = await sendPicture(ctx, bot);
      if (picture) refused[PICTURE_PART] = picture;
    }
    done(ctx, row.key, parts);
    if (Object.keys(refused).length < parts.length) ctx.result.updatedBots.push(bot.name);
    if (refused.model) ctx.result.notes.push({ kind: "model", bot: bot.name });
    if (Object.keys(refused).some((part) => part !== "model")) ctx.result.notes.push({ kind: "settings", bot: bot.name });
  }

  /** The bot's own skill, by its SKILL.md: My Cloud's copy is replaced when the text changed here. */
  async function putSkill(ctx, botId, name, replace) {
    const skill = (await localSkills(ctx, botId)).get(name);
    if (!skill) throw new CloudSendError("gone", "This skill is no longer on this computer.");
    const text = await localJson(`/api/bots/${botId}/skills/${name}`);
    if (typeof text?.text !== "string") throw new CloudSendError("local", "The skill could not be read on this computer.");
    const install = (from, body) => ctx.session.call("POST", `/api/bots/${botId}/skill-template`, {
      name, description: typeof from.description === "string" ? from.description.slice(0, 1024) : "", warnings: [],
      source: typeof from.source === "string" && from.source.trim() ? from.source.slice(0, 2000) : "this computer",
      text: body, enabled: from.enabled === true,
    });
    let previous = null;
    if (replace) {
      const listed = await ctx.session.call("GET", `/api/bots/${botId}/skills`);
      const own = await ctx.session.call("GET", `/api/bots/${botId}/skills/${name}`);
      const entry = Array.isArray(listed.body?.skills) ? listed.body.skills.find((candidate) => candidate?.name === name) : null;
      if (!own.ok || typeof own.body?.text !== "string" || !entry) throw new CloudSendError("refused", refusal(own, "My Cloud's copy of this skill could not be read, so it was left as it is."));
      previous = { entry, text: own.body.text };
      const removed = await ctx.session.call("DELETE", `/api/bots/${botId}/skills/${name}`);
      if (!removed.ok) throw new CloudSendError("refused", refusal(removed, "My Cloud could not replace this skill."));
    }
    const added = await install(skill, text.text);
    if (added.ok) return;
    if (previous) await install(previous.entry, previous.text).catch(() => null);
    throw new CloudSendError("refused", refusal(added, "My Cloud could not add this skill."));
  }

  async function sendSkill(ctx, row) {
    const there = ctx.cloudItems.get(row.key);
    const parts = row.parts ?? [];
    if (there && parts.length === 1 && parts[0] === "on") {
      const skill = (await localSkills(ctx, row.bot)).get(row.id);
      const set = await ctx.session.call("PATCH", `/api/bots/${row.bot}/skills/${row.id}`, { enabled: skill?.enabled === true });
      if (!set.ok) throw new CloudSendError("refused", refusal(set, "My Cloud could not switch this skill."));
    } else {
      if (!ctx.cloudBots.has(row.bot)) throw new CloudSendError("no_bot", "Its bot is not on My Cloud.");
      await putSkill(ctx, row.bot, row.id, Boolean(there));
    }
    done(ctx, row.key, there && parts.length === 1 && parts[0] === "on" ? parts : null);
    ctx.result.skills++;
  }

  /** A new bot's memory notes go with it once; after that each side's bot keeps its own memory. */
  async function sendMemory(ctx, botId) {
    const overview = await localJson(`/api/bots/${botId}/memory`);
    const files = ["MEMORY.md", ...(Array.isArray(overview?.topics) ? overview.topics.map((topic) => topic?.path).filter((path) => typeof path === "string") : [])];
    for (const path of files.slice(0, MEMORY_FILES)) {
      const doc = await localJson(`/api/bots/${botId}/memory/file?path=${encodeURIComponent(path)}`);
      if (!doc?.exists || typeof doc.text !== "string" || !doc.text.trim()) continue;
      const put = await ctx.session.call("PUT", `/api/bots/${botId}/memory/file`, { path, text: doc.text });
      if (!put.ok) throw new CloudSendError("refused", refusal(put, "My Cloud could not save a memory note."));
    }
  }

  async function sendSetting(ctx, row) {
    const config = await localJson("/api/config");
    const parts = row.parts ?? ["name", "email", "about", "value"];
    let body;
    if (row.key === itemKey.setting("profile")) {
      const profile = record(config?.profile) ? config.profile : {};
      const fields = { name: "name", email: "email", about: "aboutMe" };
      body = { profile: Object.fromEntries(parts.filter((part) => fields[part] && typeof profile[fields[part]] === "string").map((part) => [fields[part], profile[fields[part]]])) };
    } else if (row.key === itemKey.setting("language")) {
      if (typeof config?.language !== "string") return;
      body = { language: config.language };
    } else return;
    const saved = await ctx.session.call("PATCH", "/api/config", body);
    if (!saved.ok) throw new CloudSendError("refused", refusal(saved, "My Cloud could not save this setting."));
    done(ctx, row.key, parts);
    ctx.result.settings.push(row.label);
  }

  async function sendLogin(ctx, row) {
    const handed = await handoff({ kind: "login", id: row.id });
    const login = handed?.login;
    if (!record(login)) throw new CloudSendError("local", "This login could not be read on this computer.");
    const kept = botsOnCloud(login.bots, ctx.cloudBots);
    const saved = await ctx.session.call("POST", "/api/logins", { site: login.site, username: login.username, password: login.password,
      ...(login.totp ? { totp: login.totp } : {}), bots: kept, exactHost: login.exactHost === true });
    if (!saved.ok) throw new CloudSendError("refused", refusal(saved, "My Cloud could not save the login."));
    if (Array.isArray(login.bots) && kept.length < login.bots.length) ctx.result.notes.push({ kind: "narrowed", login: row.label });
    done(ctx, row.key);
    ctx.result.logins++;
  }

  async function sendOnePassword(ctx, row) {
    const handed = await handoff({ kind: "1password" });
    const onePassword = handed?.onePassword;
    if (!record(onePassword) || typeof onePassword.token !== "string") throw new CloudSendError("local", "1Password is not connected on this computer.");
    const parts = row.parts ?? ["token", "vaults"];
    if (row.state === "only-here" || parts.includes("token")) {
      const connected = await ctx.session.call("POST", "/api/logins/1password", { token: onePassword.token });
      if (!connected.ok) throw onePasswordRefusal(connected);
    }
    for (const [vault, bots] of Object.entries(onePassword.grants ?? {})) {
      if (!VAULT_ID.test(vault)) continue;
      const granted = await ctx.session.call("PATCH", `/api/logins/1password/vaults/${encodeURIComponent(vault)}`, { bots: botsOnCloud(bots, ctx.cloudBots) });
      if (!granted.ok && granted.status !== 404) throw new CloudSendError("refused", refusal(granted, "My Cloud connected 1Password but could not keep its vaults to the same bots."));
    }
    done(ctx, row.key);
    ctx.result.onePassword = true;
  }

  /** Keep My Cloud up to date: a cheap read of this computer every two minutes; My Cloud is asked only when something
   * here changed (or half an hour passed), and only while it is awake. The first time this computer meets a Cloud it
   * sends everything; after that new chats go at most every few minutes. A send with failures waits half an hour
   * unless something here changes. */
  async function tick() {
    timer = null;
    if (stopped) return;
    try {
      const origin = cloud.origin();
      if (saved.auto && origin && !running && !cloud.asleep()) {
        const mine = parseSendSummary(await localJson("/api/cloud-send"));
        const digest = mine ? createHash("sha256").update(JSON.stringify(mine.items)).digest("hex") : "";
        const first = !entry(origin).last;
        const backoff = digest === autoFailedDigest && now() - autoFailedAt < AUTO_FULL_MS;
        const itemsDue = digest && (digest !== autoDigest || now() - autoAt >= AUTO_FULL_MS);
        const chatsDue = view.cloud === "ready" && view.theirs?.chats && now() - chatsAt >= CHATS_EVERY_MS
          && (await chatsWaiting(origin, view.theirs)).ready.length > 0;
        if (digest && !backoff && (first || itemsDue || chatsDue)) {
          await compare();
          if (view.cloud === "ready") {
            const chats = view.theirs.chats && now() - chatsAt >= CHATS_EVERY_MS ? (await chatsWaiting(origin, view.theirs)).ready.length : 0;
            if (first || pendingRows(view.plan).length || chats) {
              const outcome = await send({ reason: first ? "first" : "auto" });
              if (outcome.result.failed.length) { autoFailedDigest = digest; autoFailedAt = now(); } else autoFailedDigest = "";
            }
            autoDigest = digest; autoAt = now();
          }
        }
      }
    } catch { /* the next tick tries again */ }
    schedule(AUTO_EVERY_MS);
  }
  function schedule(ms) {
    if (stopped) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => void tick(), ms);
    timer?.unref?.();
  }

  return {
    snapshot,
    compare,
    send,
    setAuto(on) {
      saved.auto = on === true;
      persist();
      if (saved.auto) { autoDigest = ""; schedule(1_000); }
      return publish();
    },
    /** The per-item switch. Turning on something removed on My Cloud forgets that it was sent, so it goes again. */
    setItem(key, on) {
      const origin = cloud.origin();
      if (!origin || typeof key !== "string") return publish();
      const kept = entry(origin);
      if (on) {
        if (kept.off[key] === "removed") delete kept.sent[key];
        delete kept.off[key];
      } else kept.off[key] = "you";
      persist();
      if (view.local && view.theirs) view = { ...view, plan: plan(origin, view.local, view.theirs) };
      autoDigest = "";
      return publish();
    },
    dismiss(signature) {
      const origin = cloud.origin();
      if (origin && typeof signature === "string") { entry(origin).dismissed = signature.slice(0, 20_000); persist(); }
      return publish();
    },
    start() { if (!stopped) return; stopped = false; schedule(AUTO_FIRST_MS); },
    stop() { stopped = true; if (timer !== null) clearTimer(timer); timer = null; },
    /** For the native menu: what is waiting, from the last comparison, without asking anyone; nothing while it goes by
     * itself. */
    waiting() {
      const plan = view.plan;
      if (!plan || view.cloud !== "ready" || saved.auto) return null;
      const rows = pendingRows(plan);
      return { bots: rows.filter((row) => row.kind === "bot" && row.state === "only-here").length, total: rows.length };
    },
  };
}
