import type { RuntimeEvent } from "./contracts.ts";

// A turn whose thread emits nothing for stallMs is wedged; waiting on a person or a computer is not a stall.
// Drivers report a tool only when it starts and when it ends, so a turn with a tool running may stay silent for toolStallMs.
export interface WatchedTurn {
  threadId: string;
  botId: string;
  startedAt: number;
  lastEventAt: number;
  waitingOnHuman: boolean;
  waitingOnComputer: boolean;
  runningTools: Set<string>;
}

const parked = (turn: WatchedTurn): boolean => turn.waitingOnHuman || turn.waitingOnComputer;

export interface TurnWatchdogOptions {
  stallMs: number;
  toolStallMs: number;
  checkMs: number;
  onStall: (turn: WatchedTurn, silentMs: number) => void;
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
      runningTools: new Set() });
  }

  observe(event: RuntimeEvent): void {
    const turn = this.turns.get(event.threadId);
    if (!turn) return;
    turn.lastEventAt = this.now();
    if (event.type === "item.started" && event.itemType === "tool" && event.itemId) turn.runningTools.add(event.itemId);
    else if (event.type === "item.completed" && event.itemType === "tool" && event.itemId) turn.runningTools.delete(event.itemId);
  }

  setWaitingOnHuman(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    turn.waitingOnHuman = waiting;
    turn.lastEventAt = this.now();
  }

  setWaitingOnComputer(threadId: string, waiting: boolean): void {
    const turn = this.turns.get(threadId);
    if (!turn) return;
    turn.waitingOnComputer = waiting;
    turn.lastEventAt = this.now();
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
    for (const turn of this.turns.values()) {
      if (parked(turn)) continue;
      const silentMs = turn.runningTools.size > 0 ? Math.max(this.opts.stallMs, this.opts.toolStallMs) : this.opts.stallMs;
      if (at - turn.lastEventAt < silentMs) continue;
      this.turns.delete(turn.threadId);
      this.opts.onStall(turn, silentMs);
    }
  }
}
