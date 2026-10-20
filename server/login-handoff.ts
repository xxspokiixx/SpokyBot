// "Also use on My Cloud": the desktop app's main process asks this server for one login's secrets, to send them to the
// person's own Cloud. The ask and the answer travel only over Electron's private utility-process port, which no page,
// bot, browser or other local process can reach (a plain Node server has no such port, so this never answers there).
// Nothing here is an HTTP answer, a log line or a chat message, and nothing is kept.
import type { LoginBots } from "../shared/logins.ts";
import type { LoginStore } from "./login-store.ts";
import { ONE_PASSWORD_MALFORMED, ONE_PASSWORD_REFUSED } from "./onepassword.ts";
import type { TotpKey } from "./totp.ts";

export const LOGIN_HANDOFF_REQUEST = "openmausbot:login-handoff";
export const LOGIN_HANDOFF_RESULT = "openmausbot:login-handoff-result";

export type LoginHandoffWhat = { kind: "1password" } | { kind: "login"; id: string };

/** A saved login as the Cloud's own POST /api/logins takes it: one sign-in address, the 2FA key as an otpauth:// address. */
export interface HandedLogin {
  site: string;
  exactHost: boolean;
  username: string;
  password: string;
  totp: string | null;
  bots: LoginBots;
}

export type LoginHandoffAnswer =
  | { ok: true; onePassword: { token: string; grants: Record<string, LoginBots> } }
  | { ok: true; login: HandedLogin }
  | { ok: false; error: string };
export type LoginHandoffResult = { type: typeof LOGIN_HANDOFF_RESULT; requestId: string } & LoginHandoffAnswer;

const REQUEST_ID = /^[\w-]{8,64}$/u;
const LOGIN_ID = /^[\w-]{1,128}$/u;

export function totpAddress(key: TotpKey): string {
  const query = new URLSearchParams({ secret: key.secret, algorithm: key.algorithm, digits: String(key.digits), period: String(key.period) });
  return `otpauth://totp/OpenMausBot?${query}`;
}

function parse(raw: unknown): { requestId: string; what: LoginHandoffWhat } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const message = raw as Record<string, unknown>;
  if (message.type !== LOGIN_HANDOFF_REQUEST || typeof message.requestId !== "string" || !REQUEST_ID.test(message.requestId)) return null;
  const what = message.what as Record<string, unknown> | null;
  if (what?.kind === "1password") return { requestId: message.requestId, what: { kind: "1password" } };
  if (what?.kind === "login" && typeof what.id === "string" && LOGIN_ID.test(what.id)) return { requestId: message.requestId, what: { kind: "login", id: what.id } };
  return null;
}

type HandoffStore = Pick<LoginStore, "get" | "onePasswordToken" | "onePasswordGrants">;
/** This computer's own 1Password problem, from its last read of the vaults (OnePasswordLogins.status().error). */
type OnePasswordProblem = () => string | undefined;

export const ONE_PASSWORD_DEAD_HERE = "1Password did not accept this computer's token, so it was not sent to My Cloud. Connect 1Password again in Settings → Logins with a new service account token, then send again.";

export function answerLoginHandoff(store: HandoffStore, what: LoginHandoffWhat, onePasswordProblem: OnePasswordProblem = () => undefined): LoginHandoffAnswer {
  if (what.kind === "1password") {
    const token = store.onePasswordToken();
    if (!token) return { ok: false, error: "1Password is not connected on this computer." };
    // 1Password itself refused this token here: My Cloud would only refuse it too, in words meant for its own page.
    const problem = onePasswordProblem();
    if (problem === ONE_PASSWORD_REFUSED || problem === ONE_PASSWORD_MALFORMED) return { ok: false, error: ONE_PASSWORD_DEAD_HERE };
    return { ok: true, onePassword: { token, grants: store.onePasswordGrants() } };
  }
  const login = store.get(what.id);
  if (!login) return { ok: false, error: "This login is no longer saved on this computer." };
  return { ok: true, login: { site: login.hosts[0] ?? login.site, exactHost: login.exactHost, username: login.username, password: login.password,
    totp: login.totp ? totpAddress(login.totp) : null, bots: login.bots } };
}

/** True when the message was a handoff ask, answered or refused; anything else is left for the next handler. */
export function receiveLoginHandoff(raw: unknown, store: HandoffStore, post: (message: LoginHandoffResult) => boolean, onePasswordProblem?: OnePasswordProblem): boolean {
  if ((raw as { type?: unknown } | null)?.type !== LOGIN_HANDOFF_REQUEST) return false;
  const ask = parse(raw);
  if (ask) post({ type: LOGIN_HANDOFF_RESULT, requestId: ask.requestId, ...answerLoginHandoff(store, ask.what, onePasswordProblem) });
  return true;
}
