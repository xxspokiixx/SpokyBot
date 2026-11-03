import { MAX_ROOM_TURN_TIMEOUT_MINUTES, MIN_ROOM_TURN_TIMEOUT_MINUTES, } from "./config.js";
export function roomTurnTimeoutMs(minutes) {
    return minutes * 60_000;
}
export function parseConversationTurnTimeout(value) {
    if (value === null)
        return { ok: true, minutes: null };
    if (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < MIN_ROOM_TURN_TIMEOUT_MINUTES ||
        value > MAX_ROOM_TURN_TIMEOUT_MINUTES) {
        return {
            ok: false,
            error: "Turn limit must be a whole number from 1 to 1,440, or null to use the group default.",
        };
    }
    return { ok: true, minutes: value };
}
export function effectiveRoomTurnTimeoutMinutes(globalMinutes, override) {
    if (typeof override === "number" &&
        Number.isInteger(override) &&
        override >= MIN_ROOM_TURN_TIMEOUT_MINUTES &&
        override <= MAX_ROOM_TURN_TIMEOUT_MINUTES) {
        return override;
    }
    return globalMinutes;
}
/** Counts work, not wall time: the clock holds while the turn waits on a card, and stray resolves clamp the count at zero. */
export class RoomTurnDeadline {
    remainingMs;
    timer = null;
    openRequests = 0;
    stopped = false;
    fired = false;
    armedAt = 0;
    fire;
    // No parameter properties: Node's type-stripping cannot transform them.
    constructor(minutes, fire) {
        this.remainingMs = roomTurnTimeoutMs(minutes);
        this.fire = fire;
    }
    start() {
        this.arm();
    }
    setWaitingOnHuman(waiting) {
        if (this.stopped || this.fired)
            return;
        if (waiting) {
            const wasIdle = this.openRequests === 0;
            this.openRequests += 1;
            if (wasIdle)
                this.hold();
        }
        else if (this.openRequests > 0) {
            this.openRequests -= 1;
            if (this.openRequests === 0)
                this.arm();
        }
    }
    stop() {
        this.stopped = true;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    hold() {
        if (this.timer === null)
            return;
        this.remainingMs -= Date.now() - this.armedAt;
        clearTimeout(this.timer);
        this.timer = null;
        // A delayed event loop can deliver the card event after the deadline: a person's wait must not extend an exhausted budget.
        if (this.remainingMs <= 0)
            this.expired();
    }
    arm() {
        if (this.stopped || this.fired || this.openRequests > 0)
            return;
        if (this.remainingMs <= 0) {
            this.expired();
            return;
        }
        this.armedAt = Date.now();
        this.timer = setTimeout(() => {
            this.timer = null;
            this.expired();
        }, this.remainingMs);
    }
    expired() {
        if (this.stopped || this.fired)
            return;
        this.fired = true;
        this.fire();
    }
}
export class RoomTurnStallRegistry {
    handlers = new Map();
    register(threadId, handler) {
        this.handlers.set(threadId, handler);
        return () => {
            if (this.handlers.get(threadId) === handler)
                this.handlers.delete(threadId);
        };
    }
    stall(threadId) {
        const handler = this.handlers.get(threadId);
        if (!handler)
            return false;
        this.handlers.delete(threadId);
        handler();
        return true;
    }
}
export function roomTurnTimeoutMessage(botName, minutes) {
    const unit = minutes === 1 ? "minute" : "minutes";
    return `${botName}'s room turn exceeded ${minutes} ${unit} and was stopped`;
}
