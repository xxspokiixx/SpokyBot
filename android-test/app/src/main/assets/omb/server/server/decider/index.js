import { deciderCredential } from "../included-services.js";
import { jevBackend } from "./jev.js";
import { appendDeciderLog, stateHash } from "./log.js";
import { OPENROUTER_DEFAULT_API, OPENROUTER_DEFAULT_BASE_URL, OPENROUTER_DEFAULT_MODEL, openrouterBackend } from "./openrouter.js";
import { KEY_CHECK_QUESTION, KEY_CHECK_STATE, relayAccepts, relaySeam } from "./relay.js";
export { DECIDER_JOBS } from "./types.js";
export const DEFAULT_DECIDER_TIMEOUT_MS = 1_500;
export const KEY_CHECK_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 30_000;
const offBackend = {
    id: "off",
    decide: async () => ({ ok: false, reason: "disabled" }),
};
const BACKENDS = { jev: jevBackend, openrouter: openrouterBackend };
export function deciderProvider(cfg) {
    const provider = cfg.decider?.provider ?? "jev";
    return provider in BACKENDS ? provider : "off";
}
export function deciderModel(cfg) {
    return cfg.decider?.openrouterModel?.trim() || OPENROUTER_DEFAULT_MODEL;
}
export function deciderApi(cfg) {
    if (!cfg.decider?.openrouterModel?.trim())
        return OPENROUTER_DEFAULT_API;
    return cfg.decider.openrouterApi === "decisions" ? "decisions" : "chat";
}
/** The OpenRouter key the decider uses: its own, else the one under Settings → API keys. The shared key goes
 * only to OpenRouter's default address: an operator base URL is not given the engine's key. */
export function deciderOpenRouterKey(cfg, draft) {
    const own = draft?.trim() || cfg.decider?.openrouterKey?.trim();
    if (own)
        return { token: own, source: "own" };
    const shared = sharedOpenRouterKey(cfg);
    return shared ? { token: shared, source: "shared" } : null;
}
function sharedOpenRouterKey(cfg) {
    const baseUrl = cfg.decider?.openrouterBaseUrl?.trim();
    if (baseUrl && baseUrl !== OPENROUTER_DEFAULT_BASE_URL)
        return undefined;
    return cfg.openrouter?.key?.trim() || undefined;
}
/** An own key goes to its provider (or the operator base URL); else Cloud Pro's included token goes to the
 * Admin's relay, Jev only, and only for seams the relay accepts. */
function deciderAccount(cfg, seam, draft, provider = deciderProvider(cfg)) {
    if (provider === "openrouter") {
        const key = deciderOpenRouterKey(cfg, draft);
        return key ? { token: key.token, api: cfg.decider?.openrouterBaseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL, included: false } : null;
    }
    const account = deciderCredential(draft?.trim() || cfg.decider?.key, cfg.decider?.baseUrl);
    return account?.included && seam && !relaySeam(seam) ? null : account;
}
export function deciderConfigured(cfg) {
    return Boolean(deciderAccount(cfg));
}
export function deciderIncludedHere() {
    return deciderCredential(undefined, undefined)?.included === true;
}
export function deciderEnabled(cfg) {
    const account = deciderAccount(cfg);
    if (!account || deciderProvider(cfg) === "off")
        return false;
    return account.included ? cfg.decider?.enabled !== false : cfg.decider?.enabled === true;
}
/** Absent means on. */
export function deciderJobOn(cfg, job) {
    return cfg.decider?.jobs?.[job] !== false;
}
export function deciderReady(cfg, job) {
    return deciderEnabled(cfg) && deciderJobOn(cfg, job) && Boolean(deciderAccount(cfg, job));
}
/** Whether Settings → API keys holds an OpenRouter key the decision model may use. */
export function deciderSharedKeyUsable(cfg) {
    return Boolean(sharedOpenRouterKey(cfg));
}
/** Never the key, nor the base URL (an operator setting with no UI). `keySource` and `sharedKey` are OpenRouter's. */
export function describeDecider(cfg) {
    const account = deciderAccount(cfg);
    const provider = deciderProvider(cfg);
    const key = provider === "openrouter" ? deciderOpenRouterKey(cfg) : null;
    return {
        provider: provider === "off" ? "jev" : provider,
        ...(provider === "openrouter" ? { model: deciderModel(cfg), api: deciderApi(cfg) } : {}),
        configured: Boolean(account),
        ...(key ? { keySource: key.source } : {}),
        ...(provider === "openrouter" && deciderSharedKeyUsable(cfg) ? { sharedKey: true } : {}),
        ...(account?.included ? { included: true } : {}),
        enabled: deciderEnabled(cfg),
        jobs: { roomRouting: deciderJobOn(cfg, "roomRouting") },
    };
}
/** Jobs merge per job, because saveConfig replaces a section's nested objects whole. */
export function deciderSavePatch(patch, current, fallback = {}) {
    const next = { ...patch };
    const provider = patch.provider ?? current?.provider ?? "jev";
    const field = provider === "openrouter" ? "openrouterKey" : "key";
    const fallbackHere = field === "key" ? fallback.included === true : fallback.shared === true;
    const activeKey = patch[field];
    const savingKey = typeof activeKey === "string" && Boolean(activeKey.trim());
    const clearingKey = typeof activeKey === "string" && !activeKey.trim();
    if (patch.openrouterModel !== undefined && patch.openrouterApi === undefined)
        next.openrouterApi = "chat";
    if (typeof patch.key === "string")
        next.key = patch.key.trim();
    if (typeof patch.openrouterKey === "string")
        next.openrouterKey = patch.openrouterKey.trim();
    if (savingKey) {
        next.enabled = patch.enabled ?? true;
        next.jobs = { ...current?.jobs, roomRouting: true, ...patch.jobs };
    }
    else if (clearingKey) {
        if (!fallbackHere)
            next.enabled = false;
    }
    else if (patch.jobs) {
        next.jobs = { ...current?.jobs, ...patch.jobs };
    }
    if (next.enabled === true && !savingKey && !current?.[field]?.trim() && !fallbackHere) {
        const key = field === "key" ? "a Jev API key" : "an OpenRouter API key";
        return { ok: false, error: `Save ${key} before turning on fast decisions.` };
    }
    return { ok: true, patch: next };
}
export function deciderPatchKey(patch, current) {
    const jevKey = patch.key?.trim();
    const openrouterKey = patch.openrouterKey?.trim();
    const jev = jevKey ? { provider: "jev", check: { key: jevKey, provider: "jev" } } : null;
    const savedModel = (patch.openrouterModel ?? current?.openrouterModel)?.trim();
    const api = patch.openrouterModel !== undefined ? patch.openrouterApi : patch.openrouterApi ?? current?.openrouterApi;
    const openrouter = openrouterKey
        ? {
            provider: "openrouter",
            check: {
                key: openrouterKey,
                provider: "openrouter",
                model: savedModel || OPENROUTER_DEFAULT_MODEL,
                api: savedModel ? (api === "decisions" ? "decisions" : "chat") : OPENROUTER_DEFAULT_API,
            },
        }
        : null;
    return (patch.provider ?? current?.provider) === "openrouter" ? openrouter ?? jev : jev ?? openrouter;
}
export function createDecider(deps) {
    const fetchImpl = deps.fetch ?? fetch;
    const now = deps.now ?? (() => performance.now());
    function gate(cfg, seam) {
        if (deciderProvider(cfg) === "off")
            return "disabled";
        if (seam === "keyCheck")
            return null;
        if (!deciderConfigured(cfg))
            return cfg.decider?.enabled === true ? "no_key" : "disabled";
        if (!deciderEnabled(cfg))
            return "disabled";
        if (!deciderJobOn(cfg, seam))
            return "job_off";
        if (!deciderAccount(cfg, seam))
            return "no_key";
        return null;
    }
    async function call(seam, backend, request, options) {
        const provider = backend.id === "off" ? undefined : backend.id;
        if (options.signal?.aborted)
            return { ok: false, ...(provider ? { provider } : {}), reason: "cancelled" };
        const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, options.timeoutMs ?? DEFAULT_DECIDER_TIMEOUT_MS));
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        options.signal?.addEventListener("abort", onAbort, { once: true });
        let timer;
        // The race, not only the abort, bounds the call: a body that stalls after its headers must not hold a turn.
        const timedOut = new Promise((resolve) => {
            timer = setTimeout(() => {
                controller.abort();
                resolve({ ok: false, reason: "timeout" });
            }, timeoutMs);
        });
        const started = now();
        let outcome;
        try {
            const decided = Promise.resolve()
                .then(() => backend.decide({ ...request, signal: controller.signal, fetch: fetchImpl }))
                .catch(() => ({ ok: false, reason: "malformed" }));
            outcome = await Promise.race([decided, timedOut]);
        }
        finally {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
        }
        const latencyMs = Math.max(0, Math.round(now() - started));
        if (!outcome.ok && outcome.reason !== "timeout" && options.signal?.aborted)
            outcome = { ok: false, reason: "cancelled" };
        if (provider && deps.dataDir) {
            const first = outcome.ok ? Object.values(outcome.answers).find((answer) => answer.type === "choice") : undefined;
            appendDeciderLog(deps.dataDir, {
                at: new Date().toISOString(),
                seam,
                provider,
                ...(request.model ? { model: request.model } : {}),
                ok: outcome.ok,
                ...(!outcome.ok ? { reason: outcome.reason, ...(outcome.status ? { status: outcome.status } : {}) } : {}),
                ...(first ? { choice: first.choice } : {}),
                pTop: first?.pTop ?? null,
                margin: first?.margin ?? null,
                latencyMs,
                ...(outcome.ok && outcome.inputTokens !== undefined ? { inputTokens: outcome.inputTokens } : {}),
                stateHash: stateHash(request.state),
            });
        }
        if (!outcome.ok)
            return { ok: false, ...(provider ? { provider } : {}), reason: outcome.reason, ...(outcome.status ? { status: outcome.status } : {}), latencyMs };
        return {
            ok: true,
            provider: provider,
            answers: outcome.answers,
            latencyMs,
            ...(outcome.inputTokens !== undefined ? { inputTokens: outcome.inputTokens } : {}),
            ...(outcome.model ? { model: outcome.model } : {}),
        };
    }
    async function ask(seam, state, questions, options = {}) {
        try {
            const cfg = deps.config();
            const refused = gate(cfg, seam);
            if (refused)
                return { ok: false, reason: refused };
            const provider = deciderProvider(cfg);
            const backend = provider === "off" ? offBackend : BACKENDS[provider];
            const account = deciderAccount(cfg, seam);
            // Through the included token, only the exact requests the relay takes.
            if (account.included && !relayAccepts(seam, state, questions))
                return { ok: false, reason: "misconfigured" };
            return await call(seam, backend, {
                key: account.token,
                baseUrl: account.api,
                ...(provider === "openrouter" ? { model: deciderModel(cfg), api: deciderApi(cfg) } : {}),
                state,
                questions,
            }, options);
        }
        catch {
            return { ok: false, reason: "malformed" };
        }
    }
    const single = (result) => result.ok ? { ...result, answers: result.answers.answer } : result;
    return {
        ask,
        async choose(seam, state, question, options) {
            const asked = { answer: { type: "choice", instructions: question.instructions, options: question.options } };
            return single(await ask(seam, state, asked, options));
        },
        async score(seam, state, question, options) {
            return single(await ask(seam, state, { answer: { type: "score", instructions: question.instructions, levels: question.levels } }, options));
        },
        async yesNo(seam, state, instructions, options) {
            return single(await ask(seam, state, { answer: { type: "yesno", instructions } }, options));
        },
        async testKey(input = {}, options = {}) {
            try {
                const cfg = deps.config();
                const provider = input.provider ?? deciderProvider(cfg);
                const account = deciderAccount(cfg, "keyCheck", input.key, provider);
                if (!account)
                    return { ok: false, reason: "no_key" };
                const backend = provider === "off" ? offBackend : BACKENDS[provider];
                const questions = { answer: { type: "yesno", instructions: KEY_CHECK_QUESTION } };
                if (account.included && !relayAccepts("keyCheck", KEY_CHECK_STATE, questions))
                    return { ok: false, reason: "misconfigured" };
                return single(await call("keyCheck", backend, {
                    key: account.token,
                    baseUrl: account.api,
                    ...(provider === "openrouter"
                        ? input.model?.trim()
                            ? { model: input.model.trim(), api: input.api ?? "chat" }
                            : { model: deciderModel(cfg), api: deciderApi(cfg) }
                        : {}),
                    state: KEY_CHECK_STATE,
                    questions,
                }, { timeoutMs: KEY_CHECK_TIMEOUT_MS, ...options }));
            }
            catch {
                return { ok: false, reason: "malformed" };
            }
        },
    };
}
