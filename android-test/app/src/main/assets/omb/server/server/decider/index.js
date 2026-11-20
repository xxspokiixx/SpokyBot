import { deciderCredential } from "../included-services.js";
import { helpersOn, includedAccount, jevAccount, openrouterAccount, sharedOpenRouterKey, workersAiAccount, } from "./accounts.js";
import { jevBackend } from "./jev.js";
import { appendDeciderLog, stateHash } from "./log.js";
import { OPENROUTER_DEFAULT_API, OPENROUTER_DEFAULT_MODEL, openrouterBackend } from "./openrouter.js";
import { KEY_CHECK_QUESTION, KEY_CHECK_STATE, relayAccepts, relaySeam } from "./relay.js";
import { DECIDER_JOBS } from "./types.js";
import { workersAiBackend } from "./workers-ai.js";
export { DECIDER_JOBS } from "./types.js";
export { deciderOpenRouterKey } from "./accounts.js";
export const DEFAULT_DECIDER_TIMEOUT_MS = 1_500;
export const KEY_CHECK_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 30_000;
const BACKENDS = { jev: jevBackend, workersai: workersAiBackend, openrouter: openrouterBackend };
/** The provider a draft key with no provider named is tested at: the old provider choice, else Jev. */
function draftProvider(cfg) {
    return cfg.decider?.provider === "openrouter" ? "openrouter" : "jev";
}
export function deciderModel(cfg) {
    return cfg.decider?.openrouterModel?.trim() || OPENROUTER_DEFAULT_MODEL;
}
export function deciderApi(cfg) {
    if (!cfg.decider?.openrouterModel?.trim())
        return OPENROUTER_DEFAULT_API;
    return cfg.decider.openrouterApi === "decisions" ? "decisions" : "chat";
}
/** In order: the person's own Jev key, their own Workers AI key (Clef), Cloud's included relay (only for seams it
 * accepts), the OpenRouter LLM fallback, nothing. */
export function deciderAccount(cfg, seam) {
    const jev = jevAccount(cfg);
    const candidates = [jev, workersAiAccount(cfg), jev?.included ? null : includedAccount(), openrouterAccount(cfg)];
    return candidates.find((account) => Boolean(account) && !(account.included && seam && !relaySeam(seam))) ?? null;
}
export function deciderConfigured(cfg) {
    return Boolean(deciderAccount(cfg));
}
export function deciderIncludedHere() {
    return deciderCredential(undefined, undefined)?.included === true;
}
export function deciderEnabled(cfg) {
    return helpersOn(cfg, deciderAccount(cfg));
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
/** Never a key, nor a base URL (operator settings with no UI). `provider` is the one in use; `keySource` and
 * `sharedKey` are OpenRouter's, while it is in use. Which own keys are on file is `describeHelpers`'s. */
export function describeDecider(cfg) {
    const account = deciderAccount(cfg);
    const provider = account?.provider ?? "jev";
    return {
        provider,
        ...(provider === "openrouter" ? { model: deciderModel(cfg), api: deciderApi(cfg) } : {}),
        configured: Boolean(account),
        ...(account?.keySource ? { keySource: account.keySource } : {}),
        ...(provider === "openrouter" && deciderSharedKeyUsable(cfg) ? { sharedKey: true } : {}),
        ...(account?.included ? { included: true } : {}),
        enabled: deciderEnabled(cfg),
        jobs: { roomRouting: deciderJobOn(cfg, "roomRouting") },
    };
}
const KEY_FIELDS = ["key", "workersAiToken", "openrouterKey"];
/** Jobs merge per job, because saveConfig replaces a section's nested objects whole. Saving any key switches the helper
 * models and their jobs on; clearing the last key with nothing to fall back on switches them off. */
export function deciderSavePatch(patch, current, fallback = {}) {
    const next = { ...patch };
    for (const field of [...KEY_FIELDS, "workersAiAccountId"])
        if (typeof patch[field] === "string")
            next[field] = patch[field].trim();
    const saving = KEY_FIELDS.some((field) => Boolean(next[field]));
    const clearing = KEY_FIELDS.some((field) => next[field] === "");
    const after = (field) => (typeof next[field] === "string" ? next[field] : current?.[field]?.trim()) || "";
    const ownAfter = Boolean(after("key") || after("openrouterKey") || (after("workersAiToken") && after("workersAiAccountId")));
    const fallbackHere = fallback.included === true || fallback.shared === true;
    if (patch.openrouterModel !== undefined && patch.openrouterApi === undefined)
        next.openrouterApi = "chat";
    if (next.workersAiToken && !after("workersAiAccountId"))
        return { ok: false, error: "Add your Cloudflare account ID with the token." };
    if (saving) {
        next.enabled = patch.enabled ?? true;
        next.jobs = { ...current?.jobs, roomRouting: true, ...patch.jobs };
    }
    else if (clearing) {
        if (!ownAfter && !fallbackHere)
            next.enabled = false;
    }
    else if (patch.jobs) {
        next.jobs = { ...current?.jobs, ...patch.jobs };
    }
    if (next.enabled === true && !saving && !ownAfter && !fallbackHere) {
        return { ok: false, error: "Save a Cloudflare Workers AI, Jev or OpenRouter key before turning on fast decisions." };
    }
    return { ok: true, patch: next };
}
/** What Settings says when a save's key check is refused: a fixed sentence, never the vendor's body. */
export const DECIDER_KEY_REJECTED = {
    jev: "Jev rejected this key. Check it at typesafe.ai and paste it again.",
    workersai: "Cloudflare rejected this token. Check that it has Workers AI permission and belongs to this account ID.",
    openrouter: "OpenRouter rejected this key. Check it at openrouter.ai/keys and paste it again.",
};
/** The key a save brings, to be tested before it is kept: Jev's, then Workers AI's, then OpenRouter's. */
export function deciderPatchKey(patch, current) {
    const jevKey = patch.key?.trim();
    const workersAiKey = patch.workersAiToken?.trim();
    const openrouterKey = patch.openrouterKey?.trim();
    if (jevKey)
        return { provider: "jev", check: { key: jevKey, provider: "jev" } };
    if (workersAiKey) {
        const accountId = (patch.workersAiAccountId ?? current?.workersAiAccountId)?.trim();
        return { provider: "workersai", check: { key: workersAiKey, provider: "workersai", ...(accountId ? { accountId } : {}) } };
    }
    if (!openrouterKey)
        return null;
    const savedModel = (patch.openrouterModel ?? current?.openrouterModel)?.trim();
    const api = patch.openrouterModel !== undefined ? patch.openrouterApi : patch.openrouterApi ?? current?.openrouterApi;
    return {
        provider: "openrouter",
        check: {
            key: openrouterKey,
            provider: "openrouter",
            model: savedModel || OPENROUTER_DEFAULT_MODEL,
            api: savedModel ? (api === "decisions" ? "decisions" : "chat") : OPENROUTER_DEFAULT_API,
        },
    };
}
/** The account a key check uses: a draft at the provider named (else the old provider choice), or the one in use. */
function checkAccount(cfg, input) {
    const draft = input.key?.trim();
    if (!draft && !input.provider)
        return deciderAccount(cfg, "keyCheck");
    const provider = input.provider ?? draftProvider(cfg);
    if (provider === "workersai")
        return workersAiAccount(cfg, { token: draft, accountId: input.accountId });
    if (provider === "openrouter")
        return openrouterAccount(cfg, draft);
    return jevAccount(cfg, draft) ?? includedAccount();
}
const isJob = (seam) => DECIDER_JOBS.includes(seam);
export function createDecider(deps) {
    const fetchImpl = deps.fetch ?? fetch;
    const now = deps.now ?? (() => performance.now());
    function gate(cfg, seam) {
        if (cfg.decider?.provider === "off")
            return "disabled";
        if (seam === "keyCheck")
            return null;
        if (!deciderConfigured(cfg))
            return cfg.decider?.enabled === true ? "no_key" : "disabled";
        if (!deciderEnabled(cfg))
            return "disabled";
        if (isJob(seam) && !deciderJobOn(cfg, seam))
            return "job_off";
        if (!deciderAccount(cfg, seam))
            return "no_key";
        return null;
    }
    async function call(seam, account, request, options) {
        const provider = account.provider;
        const backend = BACKENDS[provider];
        if (options.signal?.aborted)
            return { ok: false, provider, reason: "cancelled" };
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
                .then(() => backend.decide({
                key: account.token,
                baseUrl: account.api,
                ...(account.accountId ? { accountId: account.accountId } : {}),
                ...(options.careful ? { careful: true } : {}),
                ...(account.included ? { relaySeam: seam } : {}),
                ...request,
                signal: controller.signal,
                fetch: fetchImpl,
            }))
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
        if (deps.dataDir) {
            const first = outcome.ok ? Object.values(outcome.answers).find((answer) => answer.type === "choice") : undefined;
            const model = request.model ?? (outcome.ok ? outcome.model : undefined);
            appendDeciderLog(deps.dataDir, {
                at: new Date().toISOString(),
                seam,
                provider,
                ...(model && provider !== "jev" ? { model } : {}),
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
            return { ok: false, provider, reason: outcome.reason, ...(outcome.status ? { status: outcome.status } : {}), latencyMs };
        return {
            ok: true,
            provider,
            answers: outcome.answers,
            latencyMs,
            ...(outcome.inputTokens !== undefined ? { inputTokens: outcome.inputTokens } : {}),
            ...(outcome.model ? { model: outcome.model } : {}),
        };
    }
    const openrouterRequest = (cfg, account, input = {}) => account.provider !== "openrouter" ? {}
        : input.model?.trim() ? { model: input.model.trim(), api: input.api ?? "chat" } : { model: deciderModel(cfg), api: deciderApi(cfg) };
    async function ask(seam, state, questions, options = {}) {
        try {
            const cfg = deps.config();
            const refused = gate(cfg, seam);
            if (refused)
                return { ok: false, reason: refused };
            const account = deciderAccount(cfg, seam);
            // Through the included token, only the exact requests the relay takes.
            if (account.included && !relayAccepts(seam, state, questions))
                return { ok: false, reason: "misconfigured" };
            return await call(seam, account, { ...openrouterRequest(cfg, account), state, questions }, options);
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
                const account = checkAccount(cfg, input);
                if (!account)
                    return { ok: false, reason: "no_key" };
                const questions = { answer: { type: "yesno", instructions: KEY_CHECK_QUESTION } };
                if (account.included && !relayAccepts("keyCheck", KEY_CHECK_STATE, questions))
                    return { ok: false, reason: "misconfigured" };
                return single(await call("keyCheck", account, { ...openrouterRequest(cfg, account, input), state: KEY_CHECK_STATE, questions }, { timeoutMs: KEY_CHECK_TIMEOUT_MS, ...options }));
            }
            catch {
                return { ok: false, reason: "malformed" };
            }
        },
    };
}
