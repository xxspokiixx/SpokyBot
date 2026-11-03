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
        this.turns.set(threadId, { threadId, botId, startedAt: at, lastEventAt: at, waitingOnHuman: false, waitingOnComputer: false });
    }
    touch(threadId) {
        const turn = this.turns.get(threadId);
        if (turn)
            turn.lastEventAt = this.now();
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
    watching(threadId) {
        return this.turns.has(threadId);
    }
    waiting(threadId) {
        const turn = this.turns.get(threadId);
        return turn !== undefined && parked(turn);
    }
    sweep() {
        const at = this.now();
        for (const turn of this.turns.values()) {
            if (parked(turn))
                continue;
            if (at - turn.lastEventAt < this.opts.stallMs)
                continue;
            this.turns.delete(turn.threadId);
            this.opts.onStall(turn);
        }
    }
}
