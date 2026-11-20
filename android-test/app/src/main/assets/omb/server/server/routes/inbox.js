import { PASS } from "./table.js";
/** GET /api/inbox: the session's person's inbox as its panel lists it. POST /api/inbox/<line>/read and /done: one of its
 * lines read, or news they need nothing more from; each answers with the inbox as it lists them now. */
export function createInboxRoutes(deps) {
    return async ({ res, path, method, auth, json }) => {
        if (path === "/api/inbox") {
            if (method !== "GET")
                return json(res, 405, { error: "method not allowed" });
            const view = deps.view(auth);
            return view ? json(res, 200, view) : json(res, 404, { error: "There is no inbox here." });
        }
        const m = /^\/api\/inbox\/([\w-]+)\/(read|done)$/.exec(path);
        if (!m)
            return PASS;
        if (method !== "POST")
            return json(res, 405, { error: "method not allowed" });
        const marked = m[2] === "read" ? (deps.markRead(auth, m[1]) ? "done" : "unknown") : deps.markDone(auth, m[1]);
        if (marked === "unknown")
            return json(res, 404, { error: "That line is not in your inbox." });
        if (marked === "an ask")
            return json(res, 409, { error: "This waits on your answer: answer it, or close it, where it asks." });
        const view = deps.view(auth);
        return view ? json(res, 200, view) : json(res, 404, { error: "There is no inbox here." });
    };
}
