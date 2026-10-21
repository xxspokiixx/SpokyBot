// Main's side of Send to My Cloud (cloud-send.mjs): its IPC, the Cloud sessions it uses, and where its state lives.
// Chats go by row; a Cloud too old for that gets Bring newer chats' copy (cloud-move.mjs), which only adds.
// This computer's Settings may ask for everything; My Cloud's own page, verified as the person's Cloud, learns only
// what waits (sendNotice) and may start a send from the person's click. Settings → Logins' "Also use on My Cloud" is the
// same send for one login.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { BACKGROUND_HEADERS } from "./cloud-power.mjs";
import { createLoginHandoffClient, handoffWhat } from "./cloud-logins.mjs";
import { MOVE_LINE, resultKey } from "./cloud-send-parts.mjs";
import { createCloudSend, sendNotice } from "./cloud-send.mjs";

const SESSION_LABEL = "Send to My Cloud";
const MOVE_LABEL = "Move to My Cloud";
const NOT_READY = {
  outdated: "My Cloud needs an update before it can receive logins from this computer. It updates by itself; try again later.",
  asleep: "My Cloud is asleep. Open it once to wake it, then try again.",
  unreachable: "My Cloud didn't answer. Check it in Settings → MausBot Cloud, then try again.",
};
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sentence = (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null);

async function answer(response) {
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) return { status: response.status, ok: false, body: null };
  try { return { status: response.status, ok: response.ok, body: text ? JSON.parse(text) : null }; }
  catch { return { status: response.status, ok: response.ok, body: null }; }
}

/** One owner session at the person's own Cloud for one send: the Admin's one-time code for the Cloud it verified,
 * redeemed there alone; never an origin a grant names instead. A send is not someone using My Cloud, so it never keeps
 * a Cloud that sleeps awake; a move is (`background: false`), so My Cloud stays awake while it goes. */
export async function openOwnerSession(target, fetchImpl, { label = SESSION_LABEL, background = true } = {}) {
  const quiet = background ? BACKGROUND_HEADERS : {};
  let grant;
  try { grant = await target.grant(); } catch (error) { throw new Error(sentence(error?.message) ?? "My Cloud is not ready. Check it in Settings → MausBot Cloud, then try again.", { cause: error }); }
  if (!record(grant) || grant.origin !== target.origin || typeof grant.code !== "string") throw new Error("My Cloud is not ready. Check it in Settings → MausBot Cloud, then try again.");
  const paired = await answer(await fetchImpl(`${target.origin}/api/auth/pair`, {
    method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json", "content-type": "application/json", ...quiet }, body: JSON.stringify({ code: grant.code, label }),
  }));
  if (!paired.ok || typeof paired.body?.token !== "string" || !paired.body.token.startsWith("omb_sess_")) throw Object.assign(new Error("This app could not sign in to My Cloud. Try again."), { status: paired.status });
  const token = paired.body.token;
  const request = (method, route, init) => fetchImpl(`${target.origin}${route}`, {
    method, redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(120_000), ...init,
    headers: { accept: "application/json", authorization: `Bearer ${token}`, ...quiet, ...init.headers },
  });
  return {
    call: async (method, route, body) => answer(await request(method, route, body === undefined ? { headers: {} }
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
    upload: async (route, bytes, type) => answer(await request("POST", route, { headers: { "content-type": type }, body: bytes })),
    /** The answer as it came, for a download. */
    fetch: (route, init = {}) => request(init.method ?? "GET", route, { ...init, headers: init.headers ?? {} }),
    close: async () => { await request("POST", "/api/auth/logout", { headers: { "content-type": "application/json" }, body: "{}" }).then((response) => response.body?.cancel()); },
  };
}

/** What Settings → Logins compares: My Cloud's logins (site and username) and whether 1Password is connected there. */
export function loginsView(snapshot) {
  if (snapshot.cloud === "none") return { cloud: null };
  if (snapshot.cloud !== "ready") return { cloud: { reachable: false } };
  const onCloud = new Set(["on-both", "to-update", "differs"]);
  const there = [...snapshot.rows.filter((row) => row.kind === "login" && onCloud.has(row.state)), ...snapshot.cloudOnly.filter((row) => row.kind === "login")];
  const logins = there.map((row) => ({ site: /^login:([^|]+)\|/u.exec(row.key)?.[1], username: row.detail ?? "" })).filter((login) => login.site);
  const onePassword = snapshot.rows.some((row) => row.kind === "1password" && onCloud.has(row.state)) || snapshot.cloudOnly.some((row) => row.kind === "1password");
  return { cloud: { reachable: true, logins, onePassword: { connected: onePassword, vaults: [] } } };
}

/**
 * @param {{
 *   ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void },
 *   localOnly: (channel: string, handler: (...args: any[]) => unknown) => (...args: any[]) => unknown,
 *   cloudPage: (event: unknown) => "local" | "cloud" | null,
 *   server: () => { postMessage(message: unknown): void } | null | undefined,
 *   local: (route: string, init?: { method?: string }) => Promise<Response>,
 *   home: () => { origin: string, grant: () => Promise<{ origin: string, code: string }> } | null,
 *   cookieFetch: typeof fetch,
 *   reconnect: (origin: string) => Promise<boolean>,
 *   power: { asleep(): boolean },
 *   file: () => string,
 *   window: () => { isDestroyed(): boolean, webContents: { send(channel: string, value: unknown): void, mainFrame: { url: string } } } | null,
 *   localOrigin: () => string,
 *   openSettings: () => void,
 *   fetch?: typeof fetch,
 *   bringChats?: () => Promise<{ phase: string, action?: string, brought?: { conversations: number, messages: number }, error?: { message?: string } }>,
 *   engineWaitMs?: number,
 *   space?: { disk(): unknown, grow(sizeGb: number): Promise<unknown> },
 *   move?: () => { view(): unknown, seen(): unknown, retry(): Promise<unknown> } | null,
 * }} deps `bringChats`: Bring newer chats to My Cloud, as cloud-move.mjs's bring answers it. `engineWaitMs`: how long a
 * move waits for My Cloud's engines (cloud-connections.mjs). `space`: My Cloud's plan disk and the Admin's grow, so a
 * move makes room for the files it carries. `move`: the one-time move (one-home.mjs), whose line either page shows.
 */
export function installCloudSend({ ipcMain, localOnly, cloudPage, server, local, home, cookieFetch, reconnect, power, file, window, localOrigin, openSettings,
  fetch: fetchImpl = globalThis.fetch, bringChats = null, engineWaitMs, space, move = () => null }) {
  const handoff = createLoginHandoffClient();
  const pageOf = () => {
    const win = window();
    if (!win || win.isDestroyed()) return null;
    try {
      const origin = new URL(win.webContents.mainFrame.url).origin;
      return origin === localOrigin() ? "local" : origin === home()?.origin ? "cloud" : null;
    } catch { return null; }
  };
  const moving = () => move()?.view() ?? null;
  /** The notice either page gets, with the one-time move's line when there is one. */
  const notice = (snapshot) => { const line = moving(); return { ...sendNotice(snapshot), ...(line ? { move: line } : {}) }; };
  const deliver = (snapshot) => {
    const page = pageOf();
    if (page === "local") window().webContents.send("cloud-send:state-changed", snapshot);
    if (page) window().webContents.send("cloud-send:notice-changed", notice(snapshot));
  };
  const read = async (route) => {
    const target = home();
    if (!target) throw new Error("no Cloud");
    const ask = () => cookieFetch(`${target.origin}${route}`, { credentials: "include", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json", origin: target.origin, ...BACKGROUND_HEADERS } });
    const response = await ask();
    if (response.status !== 401 || !(await reconnect(target.origin))) return response;
    return ask();
  };
  const send = createCloudSend({
    local,
    cloud: {
      origin: () => home()?.origin ?? null,
      asleep: () => power.asleep(),
      read,
      open: (options) => {
        const target = home();
        if (!target) return Promise.reject(new Error("This computer has no My Cloud yet."));
        return openOwnerSession(target, fetchImpl, options?.move ? { label: MOVE_LABEL, background: false } : {});
      },
    },
    handoff: (what) => handoff.request(server(), what),
    bringChats: bringChats && (async () => {
      const state = await bringChats();
      if (state?.phase === "done" && state.action === "bring" && record(state.brought)) return { conversations: state.brought.conversations, messages: state.brought.messages };
      throw new Error(sentence(state?.error?.message) ?? "Another copy to My Cloud is running. Send again when it has finished.");
    }),
    store: {
      read: () => { try { return JSON.parse(readFileSync(file(), "utf8")); } catch { return null; } },
      write: (value) => { const target = file(); writeFileSync(`${target}.tmp`, JSON.stringify(value), { mode: 0o600 }); renameSync(`${target}.tmp`, target); },
    },
    onChange: deliver,
    engineWaitMs,
    space,
  });
  const fresh = () => send.compare().catch(() => send.snapshot());
  const options = (input) => ({
    keys: Array.isArray(input?.keys) ? input.keys.filter((key) => typeof key === "string").slice(0, 5_000) : null,
    force: Array.isArray(input?.force) ? input.force.filter((key) => typeof key === "string").slice(0, 5_000) : [],
  });
  const onPage = (channel, handler) => (event, ...args) => {
    const asking = cloudPage(event);
    if (!asking) throw new Error(`${channel} is only available in this app's window`);
    return handler(asking, ...args);
  };

  ipcMain.handle("cloud-send:state", localOnly("cloud-send:state", () => send.snapshot()));
  ipcMain.handle("cloud-send:refresh", localOnly("cloud-send:refresh", () => fresh()));
  ipcMain.handle("cloud-send:send", localOnly("cloud-send:send", (_event, input) => send.send({ ...options(input), reason: "button" })));
  ipcMain.handle("cloud-send:item", localOnly("cloud-send:item", (_event, key, on) => send.setItem(String(key), on === true)));
  ipcMain.handle("cloud-send:notice", onPage("cloud-send:notice", async () => notice(await fresh())));
  // A send that fails as a whole is this send's outcome too: the notice carries why.
  ipcMain.handle("cloud-send:page-send", onPage("cloud-send:page-send", async (asking) => {
    await send.send({ reason: asking === "cloud" ? "my-cloud" : "button" }).catch(() => {});
    return notice(send.snapshot());
  }));
  ipcMain.handle("cloud-send:dismiss", onPage("cloud-send:dismiss", (_event, signature) => {
    if (String(signature) === MOVE_LINE) {
      // The done line says what the move brought; the move's own send result is not said again after it.
      move()?.seen();
      const last = send.snapshot().last;
      return notice(last ? send.dismiss(resultKey(last)) : send.snapshot());
    }
    return notice(send.dismiss(String(signature)));
  }));
  // The move's Try again, after a day of failing.
  ipcMain.handle("cloud-send:move-retry", onPage("cloud-send:move-retry", async () => { await move()?.retry(); return notice(send.snapshot()); }));

  // Settings → Logins: the same comparison and the same send, for one login or 1Password.
  ipcMain.handle("cloud-logins:state", localOnly("cloud-logins:state", async () => loginsView(await fresh())));
  ipcMain.handle("cloud-logins:send", localOnly("cloud-logins:send", async (_event, input) => {
    const what = handoffWhat(input);
    if (!what) throw new Error("Choose a login to send to My Cloud.");
    if (!home()) throw new Error("This computer has no My Cloud yet.");
    const before = await fresh();
    if (before.cloud !== "ready") throw new Error(NOT_READY[before.cloud] ?? NOT_READY.unreachable);
    const row = before.rows.find((entry) => what.kind === "1password" ? entry.kind === "1password" : entry.kind === "login" && entry.id === what.id);
    if (!row) throw new Error(what.kind === "1password" ? "1Password is not connected on this computer." : "This login is no longer saved on this computer.");
    if (row.state === "off" || row.state === "removed") send.setItem(row.key, true);
    const outcome = await send.send({ keys: [row.key], force: [row.key], reason: "logins" });
    const failed = outcome.result.failed.find((entry) => entry.key === row.key);
    if (failed) throw new Error(failed.error);
    return { sent: true, ...(outcome.result.notes.some((note) => note.kind === "narrowed") ? { narrowed: true } : {}), ...loginsView(send.snapshot()) };
  }));

  return {
    receive: handoff.receive,
    /** The one-time move to My Cloud (cloud-send.mjs): a pass that carries everything, `final` the one after this computer
     * stops, and the check of what arrived. */
    move: (options) => send.send({ reason: "move", final: options?.final === true }),
    check: () => send.check(),
    /** Each automation the move carried, and whether it was on here when it went. */
    switches: () => send.switches(),
    snapshot: () => send.snapshot(),
    /** The move's line changed: both pages get it again. */
    publish: () => deliver(send.snapshot()),
    /** The switcher: what waits, from the last comparison (refreshed in the background), and its Send. */
    menu: () => {
      void fresh();
      const waiting = send.waiting();
      return {
        waiting,
        onSend: () => { openSettings(); void send.send({ reason: "menu" }).catch(() => {}); },
        onOpen: () => openSettings(),
      };
    },
  };
}

