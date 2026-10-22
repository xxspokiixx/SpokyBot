import type { RuntimeEvent } from "./contracts.ts";

// A turn whose thread emits nothing for stallMs is wedged; waiting on a person or a computer is not a stall.
// Drivers report a tool only when it starts and when it ends, so a turn with a tool running may stay silent for toolStallMs.
// Each tool also has a deadline of its own, toolStallMs after it started, that no other event on the turn extends: a hung
// tool beside a parallel one that keeps reporting still ends the turn.
export interface WatchedTurn {
  threadId: string;
  botId: string;
  startedAt: number;
  lastEventAt: number;
  waitingOnHuman: boolean;
  waitingOnComputer: boolean;
  /** Each running tool's start, moved forward by the time the turn then spent waiting on a person or a computer. */
  runningTools: Map<string, number>;
  parkedAt: number | null;
}

/** Which limit stopped the turn: the silence window, or one tool's own deadline. */
export interface StallLimit {
  kind: "silence" | "tool";
  ms: number;
}

const parked = (turn: WatchedTurn): boolean => turn.waitingOnHuman || turn.waitingOnComputer;

export interface TurnWatchdogOptions {
  stallMs: number;
  toolStallMs: number;
  checkMs: number;
  onStall: (turn: WatchedTurn, limit: StallLimit) => void;
  now?: () => number;
}

export class TurnWatchdog {
  private turns = new Map<string, WatchedTurn>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: TurnWatchdogOptions;

  // No parameter properties: Node's type-stripping cannot transform them.
  constructor(opts: TurnWatchdogOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.opts.checkMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.turns.clear();
  }

  watch(threadId: string, botId: string): void {
    const at = this.now();
    this.turns.set(threadId, { threadId, botId, startedAt: at, lastEventAt: at, waitingOnHuman: false, waitingOnComputer: false,
      runningTools: new Map(), parkedAt: null });
  }

  observe(event: RuntimeEvent): void {
    const turn = this.turns.get(event.threadId);
    if (!turn) return;
    const at = this.now();
    turn.lastEventAt = at;
    if ((event.type !== "item.started" && event.type !== "item.completed") || event.itemType !== "tool" || !event.itemId) return;
    // A repeated start keeps the first one's deadline.
    if (event.type === "item.completed") turn.runningTools.delete(event.itemId);
    else if (!turn.runningTools.has(event.itemId)) turn.runningTools.set(event.itemId, at);
  }

  setWaitingOnHuman(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (turn) this.park(turn, () => { turn.waitingOnHuman = waiting; });
  }

  setWaitingOnComputer(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (turn) this.park(turn, () => { turn.waitingOnComputer = waiting; });
  }

  private park(turn: WatchedTurn, update: () => void): void {
    const was = parked(turn);
    update();
    const at = this.now();
    turn.lastEventAt = at;
    if (!was && parked(turn)) turn.parkedAt = at;
    else if (was && !parked(turn) && turn.parkedAt !== null) {
      const waited = at - turn.parkedAt;
      for (const [itemId, started] of turn.runningTools) turn.runningTools.set(itemId, started + waited);
      turn.parkedAt = null;
    }
  }

  settle(threadId: string): void {
    this.turns.delete(threadId);
  }

  watching(threadId: string): boolean {
    return this.turns.has(threadId);
  }

  waiting(threadId: string): boolean {
    const turn = this.turns.get(threadId);
    return turn !== undefined && parked(turn);
  }

  sweep(): void {
    const at = this.now();
    const toolMs = Math.max(this.opts.stallMs, this.opts.toolStallMs);
    for (const turn of this.turns.values()) {
      if (parked(turn)) continue;
      const silentMs = turn.runningTools.size > 0 ? toolMs : this.opts.stallMs;
      let overdue = false;
      for (const started of turn.runningTools.values()) overdue ||= at - started >= toolMs;
      if (at - turn.lastEventAt < silentMs && !overdue) continue;
      this.turns.delete(turn.threadId);
      this.opts.onStall(turn, overdue ? { kind: "tool", ms: toolMs } : { kind: "silence", ms: silentMs });
    }
  }
}
