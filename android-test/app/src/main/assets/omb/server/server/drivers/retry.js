import { isProviderSafetyBlock } from "../../shared/provider-safety.js";
export const RETRY_MAX_ATTEMPTS = 3;
/** Backoff schedule before attempt N (N is 1-based over retries): 1s / 3s / 8s. */
export const BACKOFF_BASE_MS = [1_000, 3_000, 8_000];
const TRANSIENT_PATTERNS = [
    { pattern: /\b(?:429|rate.?limit|too many requests)\b/i, reason: "rate_limited" },
    { pattern: /\boverloaded\b|\bcapacity\b/i, reason: "overloaded" },
    { pattern: /\b5\d{2}\b|\binternal server error\b|\bbad gateway\b|\bservice unavailable\b/i, reason: "server_error" },
    // Codex's ChatGPT workspace routing lookup (codex-cli 0.160); only its "unauthorized" variant is a sign-in problem.
    { pattern: /\bworkspace routing discovery (?:failed|timed out)\b/i, reason: "server_error" },
    {
        pattern: /\b(?:econnreset|econnrefused|epipe|etimedout|eai_again|connection reset|connection refused|socket hang up|network error|fetch failed)\b/i,
        reason: "connection_reset",
    },
    { pattern: /\btimeout(ed)?\b|\btimed? out\b/i, reason: "timeout" },
];
/** A subscription's usage running out: terminal even when phrased as a rate limit. Claude Code 2.1.295
 * says "You've hit your weekly limit · resets …", "…your session limit", "…your Opus limit", "…your
 * team's shared budget", "You're out of usage credits", "You're out of extra usage". */
export const USAGE_LIMIT = /\busage limit\b|\bhit your (?:(?!rate\b)[\w'’-]+ ){0,3}(?:limit|budget)\b|\b(?:weekly|daily|monthly|subscription|usage|session|5-hour) limit reached\b|\bout of (?:usage(?: credits)?|extra usage|credits)\b/i;
const TERMINAL_PATTERNS = [
    {
        pattern: /\b(?:40[13]|unauthorized|forbidden|invalid api key|missing bearer|authentication required|not logged in|logged out)\b/i,
        reason: "auth",
    },
    // every terminal pattern is read before the transient 429 one
    { pattern: USAGE_LIMIT, reason: "quota" },
    { pattern: /\b402\b|\bquota\b|\bbilling\b|\bsubscription\b/i, reason: "quota" },
    { pattern: /\bmodel not found\b|\bunknown model\b|\bdoes not exist for model\b|\bunsupported model\b/i, reason: "unknown_model" },
    { pattern: /\b400\b|\b422\b|\binvalid request\b|\bmalformed\b|\bunexpected status\b/i, reason: "invalid_request" },
    { pattern: /\b404\b|\bno such thread\b|\bthread gone\b/i, reason: "not_found" },
    // A turn the user stopped must never come back as an auto-retry.
    { pattern: /\b(?:interrupted|cancelled by user)\b/i, reason: "interrupted" },
];
const messageOf = (err) => {
    if (!err)
        return "";
    if (err instanceof Error)
        return `${err.message}${err.cause ? ` ${String(err.cause)}` : ""}`;
    if ("text" in err)
        return err.text;
    return [err.stderr ?? "", ""].join(" ").trim();
};
/** A nonzero exit with no error text is terminal (`terminal_exit`): the CLI already reported its own
 * failure. A signal kill (negative code) is never retried. */
export function classifyError(err) {
    const text = messageOf(err);
    // A surrounding HTTP 5xx/429 must not replay a provider safety block.
    if (isProviderSafetyBlock(text))
        return { transient: false, reason: "provider_safety" };
    if (err && "exitCode" in err) {
        const { exitCode: code } = err;
        if (code !== null && code < 0)
            return { transient: false, reason: "interrupted" };
        for (const { pattern, reason } of TERMINAL_PATTERNS) {
            if (pattern.test(text))
                return { transient: false, reason };
        }
        for (const { pattern, reason } of TRANSIENT_PATTERNS) {
            if (pattern.test(text))
                return { transient: true, reason };
        }
        return { transient: false, reason: "terminal_exit" };
    }
    for (const { pattern, reason } of TERMINAL_PATTERNS) {
        if (pattern.test(text))
            return { transient: false, reason };
    }
    for (const { pattern, reason } of TRANSIENT_PATTERNS) {
        if (pattern.test(text))
            return { transient: true, reason };
    }
    return { transient: false, reason: "unknown" };
}
export function computeBackoff(attempt, random = Math.random) {
    const base = BACKOFF_BASE_MS[Math.min(Math.max(attempt, 0), BACKOFF_BASE_MS.length - 1)];
    const jitter = base * 0.25;
    return Math.round(base - jitter + random() * jitter * 2);
}
export function interruptibleDelay(ms, signal) {
    let timer = null;
    let onCancel = null;
    const promise = new Promise((resolve) => {
        timer = setTimeout(() => resolve("elapsed"), Math.max(1, ms));
        timer.unref?.();
        if (signal?.aborted)
            return resolve("cancelled");
        onCancel = () => {
            clearTimeout(timer);
            resolve("cancelled");
        };
        signal?.addEventListener("abort", onCancel, { once: true });
    });
    return {
        promise,
        cancel: () => onCancel?.(),
    };
}
