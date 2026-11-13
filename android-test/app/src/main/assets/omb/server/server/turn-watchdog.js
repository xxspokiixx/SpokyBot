// Number() also reads "Infinity" and "1e309" as numbers, and an endless limit would switch the watchdog off.
export function stallLimitMs(raw, fallback) {
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}
const parked = (turn) => turn.waitingOnHuman || turn.waitingOnComputer;
export class TurnWatchdog {
    turns = new Map();
    timer = null;
    opts;
    // No parameter properties: Node's type-stripping cannot transform them.
    constructor(opts) {
        this.opts = opts;
    }
    now() {
        return this.opts.now?.() ?? Date.now();
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.sweep(), this.opts.checkMs);
        this.timer.unref?.();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        this.turns.clear();
    }
    watch(threadId, botId) {
        const at = this.now();
        this.turns.set(threadId, { threadId, botId, startedAt: at, lastEventAt: at, waitingOnHuman: false, waitingOnComputer: false,
            runningTools: new Set() });
    }
    observe(event) {
        const turn = this.turns.get(event.threadId);
        if (!turn)
            return;
        turn.lastEventAt = this.now();
        if ((event.type !== "item.started" && event.type !== "item.completed") || event.itemType !== "tool" || !event.itemId)
            return;
        if (event.type === "item.completed")
            turn.runningTools.delete(event.itemId);
        else
            turn.runningTools.add(event.itemId);
    }
    setWaitingOnHuman(threadId, waiting) {
        const turn = this.turns.get(threadId);
        if (!turn)
            return;
        turn.waitingOnHuman = waiting;
        turn.lastEventAt = this.now();
    }
    setWaitingOnComputer(threadId, waiting) {
        const turn = this.turns.get(threadId);
        if (!turn)
            return;
        turn.waitingOnComputer = waiting;
        turn.lastEventAt = this.now();
    }
    settle(threadId) {
        this.turns.delete(threadId);
    }
    /** A Stop that discards the turn's later events leaves no way for a tool or a wait to report its end: watch the teardown as a fresh silent turn. */
    eventsDiscarded(threadId) {
        const turn = this.turns.get(threadId);
        if (turn)
            this.watch(threadId, turn.botId);
    }
    watching(threadId) {
        return this.turns.has(threadId);
    }
    waiting(threadId) {
        const turn = this.turns.get(threadId);
        return turn !== undefined && parked(turn);
    }
    /** A turn of this bot is answering now: running and not parked on a person or a computer. One that goes silent is
     * stopped by the sweep, so this never holds anything for longer than toolStallMs without events. */
    answering(botId) {
        for (const turn of this.turns.values())
            if (turn.botId === botId && !parked(turn))
                return true;
        return false;
    }
    sweep() {
        const at = this.now();
        for (const turn of this.turns.values()) {
            if (parked(turn))
                continue;
            const silentMs = turn.runningTools.size > 0 ? Math.max(this.opts.stallMs, this.opts.toolStallMs) : this.opts.stallMs;
            if (at - turn.lastEventAt < silentMs)
                continue;
            this.turns.delete(turn.threadId);
            this.opts.onStall(turn, silentMs);
        }
    }
}
