// A sign-in: the relay mints a state and a HighLevel link; the person's browser does the rest; this server polls the
// relay's claim every 2 s for up to 10 minutes and stores the tokens once. One live flow at a time, in memory only.
import { randomUUID } from "node:crypto";
import { HighLevelRelayError } from "./relay.js";
export const SIGN_IN_POLL_MS = 2_000;
export const SIGN_IN_MAX_MS = 10 * 60_000;
export class HighLevelSignIn {
    options;
    now;
    flow = null;
    /** Finished flows stay readable for a while so the app's last poll gets its answer. */
    finished = new Map();
    constructor(options) {
        this.options = options;
        this.now = options.now ?? Date.now;
    }
    /** Starts a new flow; a flow already waiting is cancelled first. */
    async start() {
        this.cancelActive("A newer sign-in replaced this one.");
        const started = await this.options.relay.start();
        const expiresAt = Math.min(started.expiresAt, this.now() + (this.options.maxMs ?? SIGN_IN_MAX_MS));
        const flow = { flowId: randomUUID(), state: started.state, authorizationUrl: started.authorizationUrl, expiresAt, phase: "waiting" };
        this.flow = flow;
        this.schedule(this.options.pollMs ?? SIGN_IN_POLL_MS);
        this.options.onChange?.();
        return { flowId: flow.flowId, authorizationUrl: flow.authorizationUrl, expiresAt: flow.expiresAt };
    }
    /** The live flow, for GET /api/highlevel. */
    active() {
        return this.flow ? { flowId: this.flow.flowId, authorizationUrl: this.flow.authorizationUrl, expiresAt: this.flow.expiresAt, phase: this.flow.phase } : null;
    }
    status(flowId) {
        if (this.flow?.flowId === flowId)
            return { phase: this.flow.phase };
        const done = this.finished.get(flowId);
        return done ? { phase: done.phase, ...(done.message ? { message: done.message } : {}) } : null;
    }
    cancel(flowId) {
        if (this.flow?.flowId !== flowId)
            return this.finished.delete(flowId);
        this.cancelActive("Cancelled.");
        return true;
    }
    close() {
        this.cancelActive("SpokyBot stopped.");
    }
    cancelActive(message) {
        const flow = this.flow;
        if (!flow)
            return;
        flow.cancelled = true;
        if (flow.timer)
            clearTimeout(flow.timer);
        this.flow = null;
        this.remember({ ...flow, phase: "failed", message });
        this.options.onChange?.();
    }
    remember(flow) {
        this.finished.set(flow.flowId, { flowId: flow.flowId, authorizationUrl: flow.authorizationUrl, expiresAt: flow.expiresAt, phase: flow.phase, ...(flow.message ? { message: flow.message } : {}) });
        while (this.finished.size > 8)
            this.finished.delete(this.finished.keys().next().value);
    }
    finish(phase, message) {
        const flow = this.flow;
        if (!flow)
            return;
        if (flow.timer)
            clearTimeout(flow.timer);
        this.flow = null;
        this.remember({ ...flow, phase, message });
        this.options.onChange?.();
    }
    schedule(ms) {
        const flow = this.flow;
        if (!flow)
            return;
        flow.timer = setTimeout(() => { void this.poll(); }, ms);
        flow.timer.unref?.();
    }
    async poll() {
        const flow = this.flow;
        if (!flow || flow.cancelled)
            return;
        if (this.now() >= flow.expiresAt)
            return this.finish("expired", "The sign-in took longer than 10 minutes. Start again.");
        let claimed;
        try {
            claimed = await this.options.relay.claim(flow.state);
        }
        catch (error) {
            // A relay hiccup is not a failed sign-in; keep polling until the flow expires.
            if (error instanceof HighLevelRelayError && error.status < 500 && error.status !== 503)
                return this.finish("failed", error.message);
            return this.schedule(this.options.pollMs ?? SIGN_IN_POLL_MS);
        }
        if (this.flow !== flow || flow.cancelled)
            return;
        if (claimed === "pending")
            return this.schedule(this.options.pollMs ?? SIGN_IN_POLL_MS);
        if (claimed === "claimed")
            return this.finish("failed", "This sign-in was already used. Start again.");
        const locationName = await this.options.lookupLocationName(claimed.accessToken, claimed.locationId).catch(() => undefined);
        if (this.flow !== flow || flow.cancelled)
            return;
        this.options.store.put({
            kind: "oauth", accessToken: claimed.accessToken, refreshToken: claimed.refreshToken, expiresAt: this.now() + claimed.expiresIn * 1000,
            locationId: claimed.locationId, ...(claimed.companyId ? { companyId: claimed.companyId } : {}), ...(claimed.userId ? { userId: claimed.userId } : {}),
            ...(locationName ? { locationName } : {}), scopes: claimed.scope,
        });
        this.finish("connected");
    }
}
