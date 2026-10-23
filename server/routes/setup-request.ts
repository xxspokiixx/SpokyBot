// Set me up under a new bot's greeting (server/setup-request.ts): POST is the press, DELETE the x on "Setting up …".
// Open to anyone who may write in that conversation (client scope, like sending a message): the press does nothing a
// typed /setup could not.
import type { RequestAuth } from "../request-auth.ts";
import { askForSetup, cancelSetupRequest, type SetupRequestStore } from "../setup-request.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface SetupRequestRouteDeps {
  store: SetupRequestStore;
  /** The language the server writes the bot's lines in. */
  language(): string | undefined;
  /** Why this caller may not write in this conversation (a Cloud guest in the owner's chat), or null. */
  sendRefusal(auth: RequestAuth, threadId: string): string | null;
}

const PATH = /^\/api\/bots\/([\w-]+)\/setup-request$/;
const ID = /^[\w-]{1,128}$/;

export function createSetupRequestRoutes(deps: SetupRequestRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = path.match(PATH);
    if (!m || (method !== "POST" && method !== "DELETE")) return PASS;
    const body = await readBody(req, 2048);
    const threadId = typeof body?.threadId === "string" ? body.threadId : "";
    if (!ID.test(threadId)) return json(res, 400, { error: "threadId is required" });
    if (!deps.store.bot(m[1]!)) return json(res, 404, { error: "no such bot" });
    const refused = deps.sendRefusal(auth, threadId);
    if (refused) return json(res, 403, { error: refused });
    if (method === "DELETE") {
      return cancelSetupRequest(deps.store, m[1]!, threadId)
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "There is no such conversation." });
    }
    const asked = askForSetup(deps.store, m[1]!, threadId, deps.language());
    if (!asked.ok) return json(res, asked.status, { error: asked.error });
    return json(res, 200, asked);
  };
}
