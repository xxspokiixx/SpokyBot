/** Leases expire if Electron crashes; human takeover always wins renewal. */
const LEASE_EXPIRY_MS = 40_000;
export class SharedComputerControl {
    leases = new Map();
    resources;
    held;
    constructor(resources, held) { this.resources = resources; this.held = held; }
    acquire(id) {
        const owner = { threadId: `shared:${id}`, generation: id };
        if (this.held() || !this.resources.claim("computer:host", owner)) {
            this.release(id);
            throw Object.assign(new Error("This computer is in use locally or held by a person. Wait, then observe it again before acting."), { status: 409 });
        }
        this.arm(id);
    }
    /** Skips the takeover checks: a heartbeat for a pending operation must not lose its own screen. */
    renew(id) {
        if (this.leases.has(id))
            this.arm(id);
    }
    /** The generation counter makes a stale timer a no-op: only the newest arming may release the lease. */
    arm(id) {
        const previous = this.leases.get(id);
        if (previous)
            clearTimeout(previous.timer);
        const generation = (previous?.generation ?? 0) + 1;
        this.leases.set(id, {
            timer: setTimeout(() => {
                if (this.leases.get(id)?.generation === generation)
                    this.release(id);
            }, LEASE_EXPIRY_MS),
            generation,
            lastActivity: Date.now(),
        });
    }
    release(id) {
        const lease = this.leases.get(id);
        if (lease) {
            clearTimeout(lease.timer);
            this.leases.delete(id);
        }
        this.resources.release({ threadId: `shared:${id}`, generation: id });
    }
    close() { for (const id of this.leases.keys())
        this.release(id); }
}
