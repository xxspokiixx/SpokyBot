// Ported from upstream's provider contracts with Promises for Effect and listeners for Stream; shapes and names are kept.
export class ProviderError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "ProviderError";
        this.code = code;
    }
}
/** The attempt never reached a prompt or client-side action and its process stopped, so the harness may recover it. */
export class TurnNotStartedError extends Error {
    turnId;
    constructor(turnId, message) {
        super(message);
        this.name = "TurnNotStartedError";
        this.turnId = turnId;
    }
}
/** The CLI refused sign-in before any model or tool activity, and its process stopped. */
export class TurnAuthenticationRefusedError extends TurnNotStartedError {
    name = "TurnAuthenticationRefusedError";
}
/** The engine's usage limit refused the turn before any model or tool activity (or is known to be refusing until
 * `resetsAt`), and no process of it is running the turn. */
export class TurnUsageLimitRefusedError extends TurnNotStartedError {
    name = "TurnUsageLimitRefusedError";
    resetsAt;
    constructor(turnId, message, resetsAt) {
        super(turnId, message);
        this.resetsAt = resetsAt;
    }
}
/** Variants are opaque provider IDs, not the cross-engine effort enum. */
export function isModelVariant(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 256 &&
        value.trim() === value && !/\p{Cc}/u.test(value);
}
/** "gpt-5.4-mini" → "Gpt 5.4 Mini", splitting on the caller's word breaks. */
export function titleCaseModelId(id, wordBreaks) {
    return id
        .split(wordBreaks)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
/** A picker label with a second facet (display name, provider host) unless the id already says it. */
export function qualifiedModelLabel(id, qualifier, options = {}) {
    const { redundantWhen = () => false, decorate = (facet) => ` — ${facet}` } = options;
    if (!qualifier || redundantWhen(id, qualifier))
        return id;
    return `${id}${decorate(qualifier)}`;
}
let eventCounter = 0;
export const newEventId = () => `ev-${Date.now().toString(36)}-${(eventCounter++).toString(36)}`;
export const newId = () => crypto.randomUUID();
