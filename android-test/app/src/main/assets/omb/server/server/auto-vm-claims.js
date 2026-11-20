export const MAX_CLAIM_ATTEMPTS = 3;
const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]);
/** A claim that never got an answer: marked `transient`, a fetch timeout, or Node's fetch failing on a socket error (its `cause`). */
export function transientClaimFailure(error) {
    for (let current = error, depth = 0; current && typeof current === "object" && depth < 4; current = current.cause, depth++) {
        const failure = current;
        if (failure.transient === true || failure.name === "TimeoutError" || (typeof failure.code === "string" && NETWORK_CODES.has(failure.code)))
            return true;
    }
    return false;
}
/** Keeps a claim's network failure recognizable through a wrapper that rewords it for the person. */
export function keepTransient(original, shown) {
    return shown instanceof Error && transientClaimFailure(original) ? Object.assign(shown, { transient: true }) : shown;
}
/** Once per dispatch generation, or again after a network failure, at most MAX_CLAIM_ATTEMPTS times. Any other rejection keeps
 * its slot marked failed, and a rejection mutates only the slot it fired from, so a stale claim never touches a newer generation's. */
export function startAutoVmClaim(table, threadId, generation, call) {
    const slot = table.get(threadId);
    if (!slot || slot.owner.threadId !== threadId || slot.owner.generation !== generation || slot.begin || slot.failed)
        return;
    const attempt = (slot.attempts ?? 0) + 1;
    slot.attempts = attempt;
    slot.retryReason = undefined;
    const begin = slot.claim(call).then(() => { slot.claimed = true; }, (error) => {
        const failure = error instanceof Error ? error.message : String(error);
        if (transientClaimFailure(error) && attempt < MAX_CLAIM_ATTEMPTS) {
            slot.retryReason = failure;
            if (slot.begin === begin)
                slot.begin = undefined;
            return;
        }
        slot.failed = true;
        slot.failure = failure;
        // A person's No is an answer, not a failure: the screen calls say so, and nothing reports a broken turn.
        if (error?.declined !== true)
            slot.onRejected?.(slot.failure, error);
    });
    slot.begin = begin;
}
export function lazyClaimRetryText(slot) {
    return `This turn could not reach ${slot.label ?? "this computer"} just now (${slot.retryReason}). This call was not performed; try it again in a moment.`;
}
export function settledWithin(work, ms, signal) {
    return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, Math.max(0, ms));
        signal?.addEventListener("abort", done, { once: true });
        work?.then(done, done);
    });
}
export function withinBudget(work, ms, message) {
    let timer;
    const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
    return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
