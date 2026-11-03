import { PASS } from "./table.js";
const HIDDEN = { status: 404, body: { error: "no such sign-in request" } };
const CARD = /^\/api\/bots\/([\w-]+)\/sign-in-cards\/([\w-]+)\/(done|cancel|save-login)$/u;
export function createSignInCardRoutes(deps) {
    return async ({ req, res, url, path, method, auth, json, readBody }) => {
        const m = CARD.exec(path);
        if (!m)
            return PASS;
        if (m[3] === "save-login" && method === "GET") {
            const threadId = url.searchParams.get("threadId") ?? "";
            const result = deps.threadVisible(auth, threadId) ? await deps.saveTarget(m[1], threadId, m[2]) : HIDDEN;
            return json(res, result.status, result.body);
        }
        if (method !== "POST")
            return PASS;
        if (m[3] === "save-login") {
            // JSON only, so a form posted from another local page cannot save one.
            const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
            if (mediaType !== "application/json")
                return json(res, 415, { error: "content-type must be application/json" });
            const body = await readBody(req, 16_384);
            const fields = body && typeof body === "object" && !Array.isArray(body) ? body : {};
            const threadId = String(fields.threadId ?? "");
            const result = deps.threadVisible(auth, threadId) ? await deps.saveLogin(m[1], threadId, m[2], fields, auth) : HIDDEN;
            return json(res, result.status, result.body);
        }
        const body = await readBody(req);
        const threadId = String(body.threadId ?? "");
        const result = deps.threadVisible(auth, threadId) ? deps.settle(m[1], threadId, m[2], m[3] === "done" ? "done" : "cancelled") : HIDDEN;
        return json(res, result.status, result.body);
    };
}
