import { engineFailureKind } from "./drivers/engine-errors.js";
import { classifyError } from "./drivers/retry.js";
import { hostTimeZone } from "./turn-clock.js";
const RETRY_MS = 15_000;
const RATE_LIMIT_RETRY_MS = 60_000;
export const ROUTINE_BUSY_RECHECK_MS = 30_000;
export const ROUTINE_BUSY_WAIT_MS = 60 * 60_000;
/** Past this, a usage limit fails the run instead: the routine's next scheduled runs come sooner. */
const LIMIT_WAIT_MS = 12 * 60 * 60_000;
const AFTER_RESET_MS = 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;
/** startTurn's codes for a bot or thread that is busy for now. */
const BUSY_CODES = new Set(["thread_busy", "thread_limit", "workspace_busy", "settling"]);
const OWNER_CAUSES = new Set(["signed_out", "credits", "usage_limit", "setup"]);
const OWNER_ACTION = {
    signed_out: "This bot's AI is signed out. Sign in again in Settings → Model providers.",
    credits: "This bot's AI account is out of credit. Add credit with the provider, or choose another AI for this bot.",
    usage_limit: "This bot's AI reached its usage limit. Its routines work again once it resets, or choose another AI for this bot now.",
};
const TRIAL_ACTION = "The trial Claude credit can't run this. Sign in with your own Claude or ChatGPT account, or add an API key.";
const RETRY_WHY = {
    stalled: "the AI stalled", restarted: "SpokyBot restarted while it ran", rate_limited: "a rate limit", provider: "a temporary error",
};
const FIRST_START = {
    stalled: "stopped when its AI stalled", restarted: "was cut off when SpokyBot restarted", rate_limited: "was stopped by a rate limit",
    provider: "failed on a temporary AI error", usage_limit: "was refused by the AI's usage limit",
};
export function classifyRoutineFailure(failure, facts = {}) {
    if (facts.cause === "busy")
        return { kind: "busy" };
    if (facts.cause === "stalled" || facts.stalled)
        return { kind: "retry", cause: "stalled" };
    const engine = engineFailureKind(failure);
    const { reason, transient } = classifyError({ text: failure });
    if (facts.trialCredit || engine === "credits")
        return { kind: "owner", cause: "credits" };
    if (facts.limitResetsAt || facts.stopReason === "quota" || engine === "usage_limit") {
        return { kind: "owner", cause: "usage_limit", ...(facts.limitResetsAt ? { resetsAt: facts.limitResetsAt } : {}) };
    }
    if (facts.stopReason === "auth_required" || reason === "auth")
        return { kind: "owner", cause: "signed_out" };
    if (reason === "quota")
        return { kind: "owner", cause: "credits" };
    if (facts.setup || facts.stopReason === "update_required" || facts.stopReason === "setup_required")
        return { kind: "owner", cause: "setup" };
    if (engine === "rate_limit" || reason === "rate_limited")
        return { kind: "retry", cause: "rate_limited" };
    if (engine === "overloaded" || engine === "server" || transient)
        return { kind: "retry", cause: "provider" };
    return { kind: "final" };
}
export function dispatchRefusal(error) {
    const code = error?.code;
    return typeof code === "string" && BUSY_CODES.has(code) ? { cause: "busy" } : {};
}
export function engineFacts({ setup, stalled, trialCredit, limitResetsAt }) {
    return { setup, stalled, trialCredit, limitResetsAt };
}
/** Host-local, with its zone: on a Cloud home the host's zone need not be the reader's. */
function when(at) {
    const timeZone = hostTimeZone();
    try {
        return `${new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })} (${timeZone})`;
    }
    catch {
        return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    }
}
/** Queues the run's one second start; false when it already had it or is not a bot's run. */
export function requeueOnce(run, cause, failure, now, at = now + (cause === "rate_limited" ? RATE_LIMIT_RETRY_MS : RETRY_MS)) {
    if (run.target !== "bot" || run.retried !== undefined)
        return false;
    run.status = "queued";
    run.retried = cause;
    run.retryAt = at;
    run.attention = cause === "usage_limit"
        ? `Waiting for the AI's usage limit to reset; this run starts again at ${when(at)}`
        : `Starting again shortly after ${RETRY_WHY[cause]}${cause === "restarted" ? "" : `: ${failure}`}`.slice(0, 500);
    delete run.error;
    return true;
}
/** The second start's own line, so a run that already did part of its work does not do it twice. */
export function retryNote(cause) {
    return `[SpokyBot: this run's first start ${FIRST_START[cause]} before it finished. If it already did part of the work, ` +
        "check what it did (files, messages sent, anything started) so nothing is done twice; then finish the routine.]";
}
function firstNotice(notices, botId, cause, at) {
    if (notices.some((notice) => notice.botId === botId && notice.cause === cause))
        return false;
    notices.push({ botId, cause, at });
    return true;
}
/** What a failed attempt becomes. A queued run is changed in place; a failing one is the caller's to fail with `error`. */
export function recoverRun(run, failure, facts, now, notices) {
    const verdict = run.target === "bot" ? classifyRoutineFailure(failure, facts) : { kind: "final" };
    const again = run.retried ? `Failed after one automatic retry: ${failure}` : failure;
    if (verdict.kind === "busy") {
        run.deferredAt ??= now;
        // A run of checked items waits as long as it takes: its bot is busy with the person, which is not a failure.
        if (now - run.deferredAt >= ROUTINE_BUSY_WAIT_MS && run.checkKey === undefined)
            return { queued: false, error: `Did not start: still busy after ${ROUTINE_BUSY_WAIT_MS / 60_000} minutes (${failure})` };
        run.status = "queued";
        run.retryAt = now + ROUTINE_BUSY_RECHECK_MS;
        run.attention = `Waiting to start: ${failure}`.slice(0, 500);
        delete run.error;
        return { queued: true };
    }
    if (verdict.kind === "retry")
        return requeueOnce(run, verdict.cause, failure, now) ? { queued: true } : { queued: false, error: again };
    if (verdict.kind === "final")
        return { queued: false, error: again };
    if (verdict.cause === "usage_limit" && facts.backupReady && requeueOnce(run, "usage_limit", failure, now, now + RETRY_MS)) {
        run.attention = "Starting again on the backup AI: this bot's AI reached its usage limit";
        return { queued: true };
    }
    const first = firstNotice(notices, run.botId, verdict.cause, now);
    const reset = verdict.resetsAt;
    if (reset && reset > now && reset - now <= LIMIT_WAIT_MS && requeueOnce(run, "usage_limit", failure, now, reset + AFTER_RESET_MS)) {
        return { queued: true, ...(first ? { alert: { detail: `This bot's AI reached its usage limit. This run starts again at ${when(reset + AFTER_RESET_MS)}.` } } : {}) };
    }
    const action = verdict.cause === "setup" ? failure : verdict.cause === "credits" && facts.trialCredit ? TRIAL_ACTION : OWNER_ACTION[verdict.cause];
    return { queued: false, error: verdict.cause === "signed_out" ? `${action} The AI said: “${failure}”` : failure, alert: first ? { detail: action } : null };
}
export function loadOwnerNotices(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((notice) => typeof notice?.botId === "string" && OWNER_CAUSES.has(notice.cause) && Number.isFinite(notice.at)
        ? [{ botId: notice.botId, cause: notice.cause, at: notice.at }] : []).slice(-500);
}
export function weekRuns(runs, routineId, now) {
    let ok = 0, total = 0;
    for (const run of runs) {
        if (run.routineId !== routineId || !["completed", "failed", "missed"].includes(run.status) || (run.finishedAt ?? run.createdAt) < now - WEEK_MS)
            continue;
        total += 1;
        if (run.status === "completed")
            ok += 1;
    }
    return total ? { ok, total } : undefined;
}
