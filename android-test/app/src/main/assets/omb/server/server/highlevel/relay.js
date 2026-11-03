// The SpokyBot relay (accounts.openmausbot.com) holds HighLevel's client secret; this server only ever sees
// tokens. Contract: spec §9 (start → authorizationUrl, claim once → tokens, refresh → new pair).
import { z } from "zod";
export const HIGHLEVEL_RELAY_URL_DEFAULT = "https://accounts.openmausbot.com";
export const HIGHLEVEL_RELAY_ENV = "OMB_HIGHLEVEL_RELAY_URL";
const RELAY_TIMEOUT_MS = 20_000;
const MAX_RELAY_BYTES = 64_000;
/** The relay URL, or null when the integration is switched off (`OMB_HIGHLEVEL_RELAY_URL=off`) or misconfigured. */
export function highlevelRelayUrl(env = process.env) {
    const raw = env[HIGHLEVEL_RELAY_ENV]?.trim();
    if (raw === undefined || raw === "")
        return HIGHLEVEL_RELAY_URL_DEFAULT;
    if (/^(off|none|0|false)$/iu.test(raw))
        return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
            return null;
        return url.origin + url.pathname.replace(/\/+$/u, "");
    }
    catch {
        return null;
    }
}
const tokensSchema = z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn: z.number().positive(),
    scope: z.string().default(""),
    locationId: z.string().min(1),
    companyId: z.string().optional(),
    userId: z.string().optional(),
});
const startSchema = z.object({
    state: z.string().min(1),
    authorizationUrl: z.string().url(),
    expiresAt: z.union([z.number(), z.string()]),
});
export class HighLevelRelayError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.name = "HighLevelRelayError";
        this.status = status;
        this.code = code;
    }
}
async function boundedJson(response) {
    const text = await response.text();
    if (text.length > MAX_RELAY_BYTES)
        throw new HighLevelRelayError(502, "relay_oversized", "The SpokyBot relay sent an oversized answer.");
    try {
        return text ? JSON.parse(text) : {};
    }
    catch {
        return {};
    }
}
export function createHighLevelRelay(relayUrl, fetchImpl = fetch) {
    const post = async (path, body) => {
        let response;
        try {
            response = await fetchImpl(`${relayUrl}${path}`, {
                method: "POST", redirect: "error",
                headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify(body), signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
            });
        }
        catch {
            throw new HighLevelRelayError(503, "relay_unreachable", "The SpokyBot relay did not answer; check the connection and try again in a minute.");
        }
        return { status: response.status, body: await boundedJson(response) };
    };
    const code = (body) => (body && typeof body === "object" && typeof body.error === "string" ? body.error : "relay_error");
    const expectTokens = (body, where) => {
        const parsed = tokensSchema.safeParse(body);
        if (!parsed.success)
            throw new HighLevelRelayError(502, "relay_bad_tokens", `The SpokyBot relay answered ${where} without a usable token set.`);
        return parsed.data;
    };
    return {
        async start() {
            const { status, body } = await post("/v1/highlevel/start", { kind: "location" });
            if (status === 503)
                throw new HighLevelRelayError(503, code(body), "HighLevel sign-in is not available on the SpokyBot relay right now.");
            if (status !== 200)
                throw new HighLevelRelayError(status, code(body), `The SpokyBot relay refused to start a HighLevel sign-in (${status}).`);
            const parsed = startSchema.safeParse(body);
            if (!parsed.success)
                throw new HighLevelRelayError(502, "relay_bad_start", "The SpokyBot relay answered without a sign-in link.");
            const expiresAt = typeof parsed.data.expiresAt === "number" ? parsed.data.expiresAt : Date.parse(parsed.data.expiresAt);
            const url = new URL(parsed.data.authorizationUrl);
            if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
                throw new HighLevelRelayError(502, "relay_bad_start", "The SpokyBot relay answered with a sign-in link that is not https.");
            }
            return { state: parsed.data.state, authorizationUrl: parsed.data.authorizationUrl, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 600_000 };
        },
        async claim(state) {
            const { status, body } = await post("/v1/highlevel/claim", { state });
            if (status === 404)
                return "pending";
            if (status === 410)
                return "claimed";
            if (status !== 200)
                throw new HighLevelRelayError(status, code(body), `The SpokyBot relay could not finish the HighLevel sign-in (${status}).`);
            return expectTokens(body, "the sign-in");
        },
        async refresh(refreshToken) {
            const { status, body } = await post("/v1/highlevel/refresh", { refreshToken });
            if (status === 401)
                throw new HighLevelRelayError(401, code(body), "HighLevel rejected the saved sign-in; connect it again.");
            if (status !== 200)
                throw new HighLevelRelayError(status, code(body), `The SpokyBot relay could not refresh the HighLevel sign-in (${status}).`);
            return expectTokens(body, "the refresh");
        },
    };
}
