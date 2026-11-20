import { PASS } from "./table.js";
export const PHONE_HOLD_PATH = "/api/phone-hold";
export function createPhoneHoldRoutes(deps) {
    return async ({ req, res, path, method, auth, json, readBody }) => {
        if (path !== PHONE_HOLD_PATH)
            return PASS;
        if (!deps.isAdmin(auth))
            return json(res, 403, { error: "Only the owner or an admin can hold the phone." });
        res.setHeader("Cache-Control", "no-store");
        if (method === "GET")
            return json(res, 200, { held: deps.hold.held });
        if (method !== "PUT")
            return json(res, 405, { error: "Use GET to look, or PUT with {\"held\":true} to take the phone." });
        let body = null;
        try {
            body = await readBody(req, 4_096);
        }
        catch {
            body = null;
        }
        // `held: true` takes it (and keeps it alive), false hands it back; `used: true` only restarts the idle time. A body
        // that says none of these changes nothing: an empty request must not seize the phone from under a bot.
        const held = body?.held;
        if (held === true)
            deps.hold.take();
        else if (held === false)
            deps.hold.release();
        else if (body?.used === true)
            deps.hold.used();
        else
            return json(res, 400, { error: "Send {\"held\":true} to take the phone, {\"held\":false} to hand it back, or {\"used\":true} for input." });
        return json(res, 200, { held: deps.hold.held });
    };
}
