// Optional "Sign in with Cursor" for a one-click Grok Bot import. Grok Bot templates live on Cursor's servers, and the
// full recipe needs a signed-in Cursor account (a free one is enough). The person signs in themselves in their own
// browser, with the PKCE flow Cursor's CLI uses (cursor.com/loginDeepControl, then api2.cursor.sh/auth/poll); Maus never
// reads another app's files or stored logins. The access token is kept in <data dir>/cursor-session.json (mode 0600),
// is sent only to api2.cursor.sh, and is used only to read a template's import details.
//
// The request and response shapes follow pi-grokbot-import by Shixuuu (MIT, github.com/Shixuuu/pi-grokbot-import,
// src/cursor-auth.mjs and src/fetch-template.mjs), reimplemented here. Every failure becomes a CursorFallback: the
// import box then keeps the card and the copy-paste export, with the fallback's one line saying why.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";

import { grokExportFromRecipe, type GrokExport, type GrokTemplateCard } from "../shared/grok-import.ts";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { addHeldSecretScrubber, HELD_SECRET_MASK } from "./redact.ts";

export const CURSOR_API = "https://api2.cursor.sh";
export const CURSOR_LOGIN_PAGE = "https://cursor.com/loginDeepControl";
export const CURSOR_SESSION_FILE = "cursor-session.json";
export const IMPORT_DETAILS_PATH = "/aiserver.v1.GrokBotService/GetGrokBotTemplateImportDetails";
const SIGN_IN_WINDOW_MS = 10 * 60_000;
const TIMEOUT_MS = 20_000;
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;

/** A reason to fall back to the copy-paste export, in one short line. */
export class CursorFallback extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorFallback";
  }
}

export interface CursorStatus {
  signedIn: boolean;
  /** A sign-in was started and Cursor has not answered yet. */
  waiting: boolean;
  error?: string;
}

export interface CursorSession {
  status(): Promise<CursorStatus>;
  /** The address the person opens in their browser to approve the sign-in. */
  startSignIn(): { url: string };
  signOut(): void;
  /** The full template as an export. Throws CursorFallback. */
  fetchTemplate(card: GrokTemplateCard): Promise<GrokExport>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The PKCE pair and login address, as Cursor's CLI builds them. */
export function cursorLogin(): { verifier: string; challenge: string; uuid: string; url: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const uuid = randomUUID();
  const query = new URLSearchParams({ challenge, uuid, mode: "login", redirectTarget: "cli" });
  return { verifier, challenge, uuid, url: `${CURSOR_LOGIN_PAGE}?${query}` };
}

/** Seconds since the epoch the JWT says it expires, or undefined. */
function tokenExpiry(token: string): number | undefined {
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return isRecord(payload) && typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

async function readCapped(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_ANSWER_BYTES) throw new CursorFallback("Cursor's answer was too large.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => {});
      throw new CursorFallback("Cursor's answer was too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The recipe download: a signed https address from Cursor's answer, fetched without the token. */
function recipeUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || isIP(host)) return null;
    return url;
  } catch {
    return null;
  }
}

export function createCursorSession(options: { dataDir: string; fetcher?: typeof fetch; now?: () => number }): CursorSession {
  const file = join(options.dataDir, CURSOR_SESSION_FILE);
  const now = options.now ?? Date.now;
  const fetcher = () => options.fetcher ?? fetch;
  let pending: { uuid: string; verifier: string; startedAt: number } | null = null;
  let lastError = "";
  let polling: Promise<void> | null = null;

  const readToken = (): string | null => {
    try {
      const saved: unknown = JSON.parse(readFileSync(file, "utf8"));
      return isRecord(saved) && typeof saved.accessToken === "string" && saved.accessToken ? saved.accessToken : null;
    } catch {
      return null;
    }
  };
  let token = readToken();
  // A token that slips into any text the app redacts (logs, tool output) is masked by value.
  addHeldSecretScrubber((text) => (token && text.includes(token) ? text.split(token).join(HELD_SECRET_MASK) : text));

  const forget = () => {
    token = null;
    rmSync(file, { force: true });
  };
  const save = (accessToken: string) => {
    mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(file, `${JSON.stringify({ version: 1, accessToken, savedAt: now() })}\n`, { mode: 0o600 });
    token = accessToken;
  };
  const signedIn = () => {
    if (!token) return false;
    const exp = tokenExpiry(token);
    if (exp !== undefined && exp * 1000 <= now()) {
      forget();
      lastError = "Your Cursor sign-in expired. Sign in again.";
      return false;
    }
    return true;
  };

  /** Only ever api2.cursor.sh; the token rides only when asked for, and a redirect is refused rather than followed. */
  const cursorFetch = (path: string, init: RequestInit, withToken: boolean) => {
    const url = new URL(path, CURSOR_API);
    if (url.origin !== CURSOR_API) throw new CursorFallback("Maus only talks to api2.cursor.sh.");
    const headers = new Headers(init.headers);
    if (withToken && token) headers.set("authorization", `Bearer ${token}`);
    return fetcher()(url.toString(), { ...init, headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  };

  const pollOnce = async () => {
    const sign = pending;
    if (!sign) return;
    if (now() - sign.startedAt > SIGN_IN_WINDOW_MS) {
      pending = null;
      lastError = "The Cursor sign-in timed out. Try again.";
      return;
    }
    let response: Response;
    try {
      const query = new URLSearchParams({ uuid: sign.uuid, verifier: sign.verifier });
      response = await cursorFetch(`/auth/poll?${query}`, { method: "GET", headers: { "x-cursor-client-type": "cli" } }, false);
    } catch {
      return; // a network blip: keep waiting
    }
    if (response.status === 404) return; // not approved yet
    if (pending !== sign) return;
    pending = null;
    if (!response.ok) {
      lastError = `Cursor did not accept the sign-in (HTTP ${response.status}). Try again.`;
      return;
    }
    const body = parseJson(await readCapped(response).catch(() => ""));
    const accessToken = isRecord(body) ? body.accessToken ?? body.access_token : undefined;
    if (typeof accessToken !== "string" || !accessToken) {
      lastError = "Cursor's answer had no sign-in in it. Try again.";
      return;
    }
    save(accessToken);
    lastError = "";
  };

  return {
    async status() {
      if (pending) await (polling ??= pollOnce().finally(() => { polling = null; }));
      const error = lastError;
      return { signedIn: signedIn(), waiting: pending !== null, ...(error && !pending ? { error } : {}) };
    },
    startSignIn() {
      const login = cursorLogin();
      pending = { uuid: login.uuid, verifier: login.verifier, startedAt: now() };
      lastError = "";
      return { url: login.url };
    },
    signOut() {
      pending = null;
      lastError = "";
      forget();
    },
    async fetchTemplate(card) {
      if (!signedIn()) throw new CursorFallback(lastError || "Sign in with Cursor to import everything at once.");
      let response: Response;
      try {
        response = await cursorFetch(IMPORT_DETAILS_PATH, {
          method: "POST",
          headers: { "content-type": "application/json", "connect-protocol-version": "1" },
          body: JSON.stringify({ shareId: card.shareId }),
        }, true);
      } catch (error) {
        if (error instanceof CursorFallback) throw error;
        throw new CursorFallback("Cursor could not be reached.");
      }
      const text = await readCapped(response).catch((error: unknown) => {
        throw error instanceof CursorFallback ? error : new CursorFallback("Cursor could not be reached.");
      });
      const details = parseJson(text);
      if (response.status === 401 || (isRecord(details) && details.code === "unauthenticated") || text.includes("ERROR_NOT_LOGGED_IN")) {
        forget();
        throw new CursorFallback("Your Cursor sign-in has expired. Sign in again.");
      }
      if (response.status === 404) throw new CursorFallback("Cursor does not share this template's setup.");
      if (!response.ok) throw new CursorFallback(`Cursor could not share this template's setup (HTTP ${response.status}).`);
      if (!isRecord(details)) throw new CursorFallback("Cursor answered in a way Maus does not understand yet.");
      const template = isRecord(details.template) ? details.template : {};
      const blob = details.blobGetUrl ?? details.blob_get_url ?? template.blobGetUrl;
      let recipe: unknown = isRecord(details.recipe) ? details.recipe : undefined;
      if (recipe === undefined) {
        const url = recipeUrl(blob);
        if (!url) throw new CursorFallback("Cursor answered in a way Maus does not understand yet.");
        try {
          // A signed download address: no token, no cookies, no redirects.
          const download = await fetcher()(url.toString(), { method: "GET", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (!download.ok) throw new CursorFallback(`The template download failed (HTTP ${download.status}).`);
          recipe = parseJson(await readCapped(download));
        } catch (error) {
          if (error instanceof CursorFallback) throw error;
          throw new CursorFallback("The template download failed.");
        }
      }
      try {
        return grokExportFromRecipe(recipe, card);
      } catch {
        throw new CursorFallback("Cursor answered in a way Maus does not understand yet.");
      }
    },
  };
}

let shared: CursorSession | null = null;
/** The app's one session, built from the data folder on first use. */
export const defaultCursorSession = (): CursorSession => (shared ??= createCursorSession({ dataDir: DATA_DIR }));
