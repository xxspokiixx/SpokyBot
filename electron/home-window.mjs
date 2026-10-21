// The desktop window once the person's bots moved to My Cloud (one-home.mjs): every path that shows a window goes
// through show(), which opens My Cloud, waking it through the Admin and signing in again by itself, or this computer's
// own screen at HOME_SCREEN_PATH while My Cloud can't be reached, its plan has a problem, or this device must sign in
// again. Until the move is done, and for someone with no Cloud, show() is exactly what the app did before.
//
// Security: this computer's frozen copy is never shown once its bots moved, and never lifted for another account or a
// signed-out app (its automations would run twice). The page that counts as home is the main window's main frame at
// My Cloud's verified origin, nothing else.
import { cloudHomeConnectUrl, cloudUnreachableText } from "./cloud-home.mjs";
import { asleepAnswer, BACKGROUND_HEADERS, openSleepingCloud, SIGNED_IN_MS } from "./cloud-power.mjs";
import { parseJournal } from "./one-home.mjs";

export const HOME_SCREEN_PATH = "/home";
/** The look at an awake My Cloud before the window moves there: under 3 s, so the offline screen shows within 3 s. */
export const LOOK_MS = 2_500;
export const RETRY_MS = Object.freeze([2_000, 4_000, 8_000, 15_000, 30_000]);
/** A new version of My Cloud's page waits for this long without typing before the window reloads it. */
export const QUIET_MS = 30_000;
export const VERSION_EVERY_MS = 60_000;
/** While the startup screen is up, a wake that takes longer hands over to this computer's screen, which says the same. */
export const SPLASH_HANDOFF_MS = 6_000;
export const SPLASH_TEXT = Object.freeze({ opening: "Opening My Cloud…", waking: "Waking My Cloud…" });
const PLAN_PROBLEMS = new Set(["stopped", "payment-problem", "failed"]);
const MOVING = new Set(["freeze", "final", "check"]);
const DEFAULT_TIMERS = {
  set: (work, ms) => { const timer = setTimeout(work, ms); timer.unref?.(); return timer; },
  clear: (timer) => clearTimeout(timer),
  every: (work, ms) => { const timer = setInterval(work, ms); timer.unref?.(); return timer; },
};

const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

/**
 * Who the window opens. `journal`: one-home.json read back; `frozenCloud`: this computer's freeze marker when there is no
 * journal (its Cloud's origin, or true when it names none); `state`: the MausBot Cloud sign-in's state.
 * @returns {{ kind: "computer" } | { kind: "cloud", origin: string } | { kind: "signin", other?: true }}
 */
export function homeOf({ journal = null, frozenCloud = null, state = null }) {
  const moved = journal ? (["switch", "done"].includes(journal.phase) ? journal.cloud : null)
    : frozenCloud ? { origin: typeof frozenCloud === "string" ? frozenCloud : null, account: null } : null;
  if (!moved) return { kind: "computer" };
  const connected = state?.status === "connected";
  if (connected && state.machine?.hold) return { kind: "computer" };
  const signedIn = state?.account?.id ?? null;
  if (!signedIn || state.status === "signed-out" || state.status === "connecting") return { kind: "signin" };
  if (moved.account && moved.account !== signedIn) return { kind: "signin", other: true };
  const theirs = connected ? state.machine?.origin ?? null : null;
  const origin = moved.origin ?? theirs;
  if (!origin) return { kind: "signin" };
  if (!moved.account && theirs && theirs !== origin) return { kind: "signin", other: true };
  return { kind: "cloud", origin };
}

/** Only a same-origin path survives a sign-in: never another site, never a code. */
export function routeOf(url, origin) {
  try {
    const at = new URL(url);
    if (at.origin !== origin || at.pathname === "/pair") return null;
    const route = `${at.pathname}${at.search}`;
    return route === "/" ? null : route;
  } catch { return null; }
}

/**
 * @param {{
 *   journal(): unknown,
 *   frozen(): Promise<{ frozen: boolean, cloud?: string } | null>,
 *   account(): { state(): any, power(): any, wakeHome(): Promise<unknown>, setWaking(on: boolean): void, pairHome(): Promise<{ origin: string, code: string, expiresAt: number }>,
 *     signInAgain(): Promise<unknown>, begin(): Promise<unknown> } | null,
 *   restored?(): Promise<unknown>,
 *   window(): { isDestroyed(): boolean, webContents: { id: number, getURL(): string, reload(): void } } | null,
 *   ensureWindow(): void,
 *   localOrigin(): string,
 *   cookieFetch: typeof fetch,
 *   power: { asleep(): boolean, hold(): void, woke(): void },
 *   go(url: string, origin: string | null): Promise<unknown>,
 *   showLocal(leaving: boolean): unknown,
 *   splash?(): { status(text: string): void } | null,
 *   lastInput?(): number,
 *   publish?(view: unknown): void,
 *   versionEveryMs?: number,
 *   quietMs?: number,
 *   now?(): number,
 *   timers?: { set(work: () => void, ms: number): unknown, clear(timer: unknown): void, every(work: () => void, ms: number): unknown },
 *   log?(line: string): void,
 * }} deps `go(url, origin)`: main's one way to move the window, to My Cloud (`origin`) or this computer's screen (null).
 * `showLocal(leaving)`: the window as it was before the move (this computer's page, or a saved server it shows);
 * `leaving`: it showed My Cloud or this computer's screen until now, so it goes back to this computer's page. `frozen()`:
 * this computer's server's freeze marker. `splash()`: the startup screen while it is up.
 */
export function createHomeWindow(deps) {
  const { journal, frozen, account, restored = async () => {}, window, ensureWindow, localOrigin, cookieFetch, power, go, showLocal,
    splash = () => null, lastInput = () => 0, publish = () => {}, versionEveryMs = VERSION_EVERY_MS, quietMs = QUIET_MS,
    now = Date.now, timers = DEFAULT_TIMERS, log = () => {} } = deps;
  let home = { kind: "computer" }, screen = null, status = null, opens = 0, retry = null, tries = 0, loaded = null, newer = false, repairing = null;
  /** The window shows My Cloud or this computer's screen, which this computer's page replaces once home is here again. */
  let away = false;
  const state = () => account()?.state() ?? null;
  const wanted = (token) => token === opens;
  const cloudOrigin = () => (home.kind === "cloud" ? home.origin : null);

  async function refresh() {
    const kept = parseJournal(journal());
    let frozenCloud = null;
    if (!kept) {
      const marker = await frozen().catch(() => null);
      if (marker?.frozen) frozenCloud = typeof marker.cloud === "string" ? marker.cloud : true;
    }
    if (frozenCloud || (kept && ["switch", "done"].includes(kept.phase))) await restored();
    home = homeOf({ journal: kept, frozenCloud, state: state() });
    return home;
  }

  /** What this computer's screen says: why My Cloud isn't open, or that it is opening. */
  function view() {
    if (screen) return screen;
    if (status) return { screen: status };
    if (home.kind === "signin") return { screen: "signin" };
    return { screen: MOVING.has(parseJournal(journal())?.phase ?? "") ? "moving" : "opening" };
  }
  const tell = () => { try { publish(view()); } catch {} };
  function say(next) {
    status = next;
    if (next) { try { splash()?.status(SPLASH_TEXT[next]); } catch {} }
    tell();
  }
  const shows = (origin) => {
    const win = window();
    return Boolean(win && !win.isDestroyed()) && originOf(win.webContents.getURL()) === origin;
  };
  const onScreen = () => {
    const win = window();
    if (!win || win.isDestroyed()) return false;
    try { const at = new URL(win.webContents.getURL()); return at.origin === localOrigin() && at.pathname === HOME_SCREEN_PATH; } catch { return false; }
  };
  const clearRetry = () => { if (retry) timers.clear(retry); retry = null; };

  function goScreen() {
    tell();
    away = true;
    if (!onScreen()) void Promise.resolve(go(`${localOrigin()}${HOME_SCREEN_PATH}`, null)).catch(() => {});
  }
  function toScreen(next) {
    screen = next;
    status = null;
    goScreen();
  }

  /** My Cloud didn't answer: this computer's screen says so, with the Admin's reason, and looks again by itself. */
  function offline(token) {
    if (!wanted(token)) return;
    const reason = cloudUnreachableText(state(), cloudOrigin());
    toScreen({ screen: "offline", ...(reason ? { reason } : {}) });
    later();
  }
  function later() {
    clearRetry();
    const ms = RETRY_MS[Math.min(tries, RETRY_MS.length - 1)];
    tries += 1;
    retry = timers.set(() => { retry = null; if (screen) void show(); }, ms);
  }
  const signInNeeded = () => ["reauth-required", "signed-out"].includes(state()?.status);

  async function answers(origin) {
    try {
      const response = await cookieFetch(`${origin}/api/health`, { credentials: "include", cache: "no-store", redirect: "manual",
        signal: AbortSignal.timeout(LOOK_MS), headers: { accept: "application/json", ...BACKGROUND_HEADERS } });
      await response.body?.cancel?.().catch(() => {});
      if (asleepAnswer(response)) return "asleep";
      return response.type === "opaqueredirect" || response.status < 500 ? "yes" : "no";
    } catch { return "no"; }
  }
  async function signedInAt(origin, timeoutMs) {
    try {
      const response = await cookieFetch(`${origin}/api/auth/session`, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      return response.ok && (await response.json())?.kind === "session";
    } catch { return false; }
  }

  async function connect(origin, token, open) {
    if (shows(origin) && !screen && !open) return;
    clearRetry();
    const client = account();
    const machine = state()?.status === "connected" ? state().machine : null;
    if (machine && PLAN_PROBLEMS.has(machine.status)) { toScreen({ screen: "plan", machine: machine.status }); later(); return; }
    const win = window();
    const blank = !win || win.isDestroyed() || !originOf(win.webContents.getURL());
    let asleep = power.asleep();
    say(asleep ? "waking" : "opening");
    const handoff = blank ? timers.set(() => { if (wanted(token) && status) goScreen(); }, SPLASH_HANDOFF_MS) : null;
    try {
      if (!asleep) {
        const look = await answers(origin);
        if (look === "no") return offline(token);
        if (look === "asleep") { power.hold(); asleep = true; say("waking"); }
      }
      const signedIn = asleep
        ? await openSleepingCloud({ power: client?.power() ?? { state: "asleep" }, wake: () => client?.wakeHome(), waking: (on) => client?.setWaking(on), signedIn: (ms) => signedInAt(origin, ms) })
        : await signedInAt(origin, SIGNED_IN_MS);
      if (!wanted(token)) return;
      let grant = null;
      if (!signedIn) {
        try { grant = await client?.pairHome(); } catch (error) { log(`home: no sign-in code for My Cloud (${error?.message ?? error})`); }
        if (!wanted(token)) return;
        if (!grant) {
          if (signInNeeded()) return toScreen({ screen: "signin" });
          return offline(token);
        }
      }
      screen = null; status = null; tries = 0; away = true;
      await go(cloudHomeConnectUrl({ origin, grant }, now(), open === "phone" ? "phone" : null), origin);
      power.woke();
      tell();
    } finally {
      if (handoff) timers.clear(handoff);
    }
  }

  /** Shows the window onto the person's home. `open: "phone"` opens My Cloud's Settings on its phone pairing. */
  async function show({ open = null } = {}) {
    const token = ++opens;
    const current = await refresh();
    if (!wanted(token)) return;
    if (current.kind === "computer") {
      clearRetry(); screen = null; status = null;
      const win = window();
      const leaving = away || Boolean(win && !win.isDestroyed() && !originOf(win.webContents.getURL()));
      away = false;
      return showLocal(leaving);
    }
    ensureWindow();
    if (current.kind === "signin") { clearRetry(); return toScreen({ screen: "signin", ...(current.other ? { other: true } : {}) }); }
    return connect(current.origin, token, open);
  }

  /** My Cloud's session in this window ended: a new one by itself, back where the page was. */
  function repair() {
    if (repairing || home.kind !== "cloud") return repairing ?? Promise.resolve();
    const origin = home.origin;
    repairing = (async () => {
      if (await signedInAt(origin, SIGNED_IN_MS)) return;
      const win = window();
      const route = win && !win.isDestroyed() ? routeOf(win.webContents.getURL(), origin) : null;
      let grant = null;
      try { grant = await account()?.pairHome(); } catch (error) { log(`home: could not sign in to My Cloud again (${error?.message ?? error})`); }
      if (home.origin !== origin) return;
      if (!grant) return signInNeeded() ? toScreen({ screen: "signin" }) : offline(++opens);
      await go(cloudHomeConnectUrl({ origin, grant }, now(), null, route), origin);
    })().finally(() => { repairing = null; });
    return repairing;
  }

  async function version(origin) {
    try {
      const response = await cookieFetch(`${origin}/.well-known/openmausbot/environment`, { cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(LOOK_MS), headers: { accept: "application/json", ...BACKGROUND_HEADERS } });
      const body = response.ok ? await response.json() : null;
      return typeof body?.version === "string" ? body.version : null;
    } catch { return null; }
  }
  /** A newer My Cloud page reloads at a quiet moment; an asleep My Cloud is never asked (that would start it). */
  async function watchVersion() {
    const origin = cloudOrigin();
    if (!origin || !shows(origin) || power.asleep()) return;
    const current = await version(origin);
    if (!current) return;
    if (!loaded) { loaded = current; return; }
    if (current !== loaded) newer = true;
    if (!newer || now() - lastInput() < quietMs || !shows(origin)) return;
    newer = false; loaded = current;
    window()?.webContents.reload();
  }
  const watcher = timers.every(() => { void watchVersion(); }, versionEveryMs);

  return {
    show,
    refresh,
    view,
    /** My Cloud's origin while it is home, else null. */
    cloudOrigin,
    /** Home as last worked out. */
    current: () => home,
    /** The person asked again (the screen's timer, back online, or the window focused). */
    retry: () => show(),
    /** The screen's one button: this device's MausBot Cloud sign-in, again. */
    async signIn() {
      const client = account();
      if (!client) return;
      await (client.state().status === "reauth-required" ? client.signInAgain() : client.begin());
    },
    repair,
    /** The MausBot Cloud sign-in changed: a window that waits on it, or a home that changed, shows again. */
    async changed() {
      const before = home;
      const after = await refresh();
      if (after.kind !== before.kind || after.origin !== before.origin || screen || status) await show();
    },
    /** A response the window got (Electron's webRequest): a 401 from My Cloud's API means its session ended. */
    responded({ url, statusCode, webContentsId }) {
      const origin = cloudOrigin(), win = window();
      if (statusCode !== 401 || !origin || !win || win.isDestroyed() || webContentsId !== win.webContents.id) return;
      try { const at = new URL(url); if (at.origin !== origin || !at.pathname.startsWith("/api/")) return; } catch { return; }
      void repair();
    },
    /** The main frame went somewhere: My Cloud's own sign-in page means its session ended; any other page of it is
     * the version the window now shows. */
    navigated(url) {
      const origin = cloudOrigin();
      if (!origin || originOf(url) !== origin) return;
      const at = new URL(url);
      if (at.pathname === "/pair" && !/[#&]code=/.test(at.hash)) { void repair(); return; }
      newer = false; loaded = null;
      void version(origin).then((current) => { if (current && cloudOrigin() === origin) loaded = current; });
    },
    /** The main frame could not load My Cloud. */
    failed(url) {
      const origin = cloudOrigin();
      if (origin && originOf(url) === origin) offline(++opens);
    },
    /** `event` came from My Cloud's own page in this window, while it is home. */
    homePage(event) {
      const origin = cloudOrigin(), win = window();
      if (!origin || !win || win.isDestroyed() || event?.sender !== win.webContents || !event.senderFrame || event.senderFrame !== win.webContents.mainFrame) return false;
      return originOf(event.senderFrame.url) === origin;
    },
    /** `event` came from this computer's screen in this window. */
    screenPage(event) {
      const win = window();
      if (!win || win.isDestroyed() || event?.sender !== win.webContents || !event.senderFrame || event.senderFrame !== win.webContents.mainFrame) return false;
      return originOf(event.senderFrame.url) === localOrigin();
    },
    close() { opens++; clearRetry(); timers.clear(watcher); },
  };
}

/** The window's IPC: this computer's screen reads why My Cloud isn't open and asks again; My Cloud's own page, while it
 * is home, asks for a new session; either asks this device's sign-in again (from the person's click on My Cloud). */
export function installHomeWindowIpc({ ipcMain, homeWindow, cloudPage }) {
  const from = (channel, allowed, handler) => (event, ...args) => {
    if (!allowed(event)) throw new Error(`${channel} is only available in this app's window`);
    return handler(...args);
  };
  const screenPage = (event) => homeWindow.screenPage(event);
  ipcMain.handle("home:state", from("home:state", screenPage, () => homeWindow.view()));
  ipcMain.handle("home:retry", from("home:retry", screenPage, () => homeWindow.retry().then(() => homeWindow.view())));
  ipcMain.handle("home:sign-in", from("home:sign-in", (event) => screenPage(event) || cloudPage(event) === "cloud", () => homeWindow.signIn()));
  ipcMain.handle("home:repair", from("home:repair", (event) => homeWindow.homePage(event), () => homeWindow.repair()));
  ipcMain.on("home:page", (event) => { try { event.returnValue = homeWindow.homePage(event); } catch { event.returnValue = false; } });
}
