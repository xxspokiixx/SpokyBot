// Who drives a bot's computer. A bot can only ask for hands (requestHelp); only the person takes and releases. While the
// person holds control the bot's actions are refused, never queued: a queued click would land on whatever is under it later.
// A plea is settled only by its sign-in card. In memory on purpose: a hold that survived a restart would brick the computer.
const NO_CONTROL = { held: false, helpReason: null, heldSinceMs: null };
const MAX_REASON_CHARS = 280;
export class ComputerControl {
    entries = new Map();
    onChange;
    now;
    constructor(onChange = () => { }, now = Date.now) {
        this.onChange = onChange;
        this.now = now;
    }
    snapshot(botId) {
        const entry = this.entries.get(botId);
        if (!entry)
            return NO_CONTROL;
        const plea = entry.pleas.at(-1);
        return {
            held: entry.heldSinceMs !== null,
            helpReason: plea?.reason ?? null,
            heldSinceMs: entry.heldSinceMs,
            ...(plea ? { help: plea.ref } : {}),
        };
    }
    /** Idempotent: a second click must not reset `heldSinceMs`. */
    take(botId) {
        const entry = this.entries.get(botId);
        if (entry?.heldSinceMs != null)
            return this.snapshot(botId);
        this.entries.set(botId, { heldSinceMs: this.now(), pleas: entry?.pleas ?? [], controlLeaseId: null });
        return this.changed(botId);
    }
    /** The opaque lease is never returned in a snapshot, broadcast or API response. */
    acquireLease(botId, controlLeaseId) {
        const entry = this.entries.get(botId);
        if (entry?.heldSinceMs != null) {
            return {
                snapshot: this.snapshot(botId),
                owned: entry.controlLeaseId === controlLeaseId,
                acquired: false,
            };
        }
        this.entries.set(botId, { heldSinceMs: this.now(), pleas: entry?.pleas ?? [], controlLeaseId });
        return { snapshot: this.changed(botId), owned: true, acquired: true };
    }
    ownsLease(botId, controlLeaseId) {
        const entry = this.entries.get(botId);
        return entry?.heldSinceMs != null && entry.controlLeaseId === controlLeaseId;
    }
    /** An open plea stays: handing back is not answering the card that asked. */
    release(botId) {
        const entry = this.entries.get(botId);
        if (!entry || (entry.heldSinceMs === null && entry.pleas.length))
            return this.snapshot(botId);
        this.drop(botId, entry);
        return this.changed(botId);
    }
    /** A newer or legacy holder is observed but never disturbed. */
    releaseLease(botId, controlLeaseId) {
        const entry = this.entries.get(botId);
        if (!entry || entry.heldSinceMs === null || entry.controlLeaseId !== controlLeaseId) {
            return { snapshot: this.snapshot(botId), released: false };
        }
        this.drop(botId, entry);
        return { snapshot: this.changed(botId), released: true };
    }
    /** Never grants anything by itself; the same card asking again replaces its own plea. */
    requestHelp(botId, reason, ref) {
        const text = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON_CHARS) : "";
        const entry = this.entries.get(botId) ?? { heldSinceMs: null, pleas: [], controlLeaseId: null };
        entry.pleas = [...entry.pleas.filter((plea) => plea.ref.messageId !== ref.messageId),
            { reason: text || `sign in to ${ref.site}`, ref }];
        this.entries.set(botId, entry);
        return this.changed(botId);
    }
    settleHelp(messageId) {
        const settled = [];
        for (const [botId, entry] of this.entries) {
            if (!entry.pleas.some((plea) => plea.ref.messageId === messageId))
                continue;
            entry.pleas = entry.pleas.filter((plea) => plea.ref.messageId !== messageId);
            if (entry.heldSinceMs === null && !entry.pleas.length)
                this.entries.delete(botId);
            settled.push(botId);
            this.changed(botId);
        }
        return settled;
    }
    forget(botId) {
        if (this.entries.delete(botId))
            this.onChange(botId, NO_CONTROL);
    }
    drop(botId, entry) {
        if (entry.pleas.length)
            this.entries.set(botId, { heldSinceMs: null, pleas: entry.pleas, controlLeaseId: null });
        else
            this.entries.delete(botId);
    }
    changed(botId) {
        const snapshot = this.snapshot(botId);
        this.onChange(botId, snapshot);
        return snapshot;
    }
}
