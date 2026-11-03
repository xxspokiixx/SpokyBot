import { z } from "zod";
import { LiveSessionError, MAX_SDP_BYTES } from "../live-call.js";
import { LiveCallBusyError } from "../live-call-controller.js";
import { PASS } from "./table.js";
const id = z.string().regex(/^[\w-]{1,120}$/);
const sessionBody = z.object({
    botId: id,
    threadId: id.optional(),
    // Not trimmed: the SDP offer goes to OpenAI byte for byte.
    sdp: z.string().min(1).refine((sdp) => Buffer.byteLength(sdp) <= MAX_SDP_BYTES),
    client: z.enum(["desktop", "web", "ios", "android"]),
}).strict();
const endBody = z.object({ callId: z.string().min(1).max(120) }).strict();
// Strict, so `key` is refused rather than ignored: the key is saved only through the credential store or PUT /api/config.
const settingsBody = z.object({
    voice: z.string().trim().max(40).regex(/^[a-z]*$/).optional(),
    readTypedReplies: z.boolean().optional(),
    idleMinutes: z.number().int().min(1).max(60).optional(),
}).strict();
const DEVICE_ID = /^[\w-]{1,128}$/;
/** The companion sends its own id for the phone that authenticated, never one the phone chose. */
function companionDevice(req) {
    if (req.headers["x-openmausbot-companion"] !== "1")
        return undefined;
    const device = req.headers["x-openmausbot-companion-device"];
    return typeof device === "string" && DEVICE_ID.test(device) ? device : undefined;
}
async function bodyOf(req, readBody) {
    try {
        return await readBody(req);
    }
    catch {
        return undefined;
    }
}
export function createLiveRoutes(deps) {
    return async ({ req, res, path, method, auth, json, readBody }) => {
        if (!path.startsWith("/api/live/"))
            return PASS;
        if (method === "POST" && path === "/api/live/session") {
            const parsed = sessionBody.safeParse(await bodyOf(req, readBody));
            if (!parsed.success)
                return json(res, 400, { error: "The call request was not valid." });
            const target = deps.resolveTarget(parsed.data.botId, parsed.data.threadId);
            if (!target)
                return json(res, 404, { error: "That bot or chat does not exist." });
            try {
                const device = companionDevice(req);
                const { call, sdp } = await deps.calls.start({ auth, ...(device ? { device } : {}), ...target, client: parsed.data.client, sdp: parsed.data.sdp });
                return json(res, 201, { call, transport: { type: "webrtc", sdp } });
            }
            catch (error) {
                if (error instanceof LiveCallBusyError)
                    return json(res, 409, { error: error.message, activeCall: error.call });
                if (error instanceof LiveSessionError) {
                    return json(res, error.status, error.status === 409 ? { error: error.message, needsKey: true } : { error: error.message });
                }
                throw error;
            }
        }
        if (method === "POST" && path === "/api/live/call/end") {
            const parsed = endBody.safeParse(await bodyOf(req, readBody));
            if (!parsed.success)
                return json(res, 400, { error: "The request was not valid." });
            const call = await deps.calls.end(parsed.data.callId);
            return call ? json(res, 200, { call }) : json(res, 404, { error: "That call is not running." });
        }
        if (method === "GET" && path === "/api/live/call")
            return json(res, 200, { call: deps.calls.current() });
        if (method === "POST" && path === "/api/live/device-revoked") {
            if (req.headers["x-openmausbot-companion"] !== "1")
                return json(res, 403, { error: "Only the phone companion can report an unpaired phone." });
            const device = companionDevice(req);
            if (!device)
                return json(res, 400, { error: "The unpaired phone was not named." });
            return json(res, 200, { call: deps.calls.deviceRevoked(device) });
        }
        if (method === "PATCH" && path === "/api/live/settings") {
            const parsed = settingsBody.safeParse(await bodyOf(req, readBody));
            if (!parsed.success) {
                return json(res, 400, { error: "Those Live settings are not valid." });
            }
            if (!Object.keys(parsed.data).length)
                return json(res, 400, { error: "nothing to save" });
            return json(res, 200, { live: await deps.saveSettings(parsed.data) });
        }
        return PASS;
    };
}
