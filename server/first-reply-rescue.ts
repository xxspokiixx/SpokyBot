// The first-reply rescue, for every engine: a turn whose AI has sent nothing at all (no text, thinking, tool call
// or progress) some seconds after it started gets one notice in its chat, which the desktop draws with "Switch AI"
// and "Connect your subscription". The notice settles once the AI's first output arrives. Silence later in a turn
// stays the engine's own business (the ACP quiet watch speaks at 60 s and 180 s).
import { firstReplySettledName, firstReplyWaitingName, type FirstReplyRescue } from "../shared/first-reply-rescue.ts";
import type { RuntimeEvent } from "./contracts.ts";
import type { BotRecord, Store } from "./store.ts";

export const DEFAULT_FIRST_REPLY_NOTICE_MS = 20_000;

/** OMB_FIRST_REPLY_NOTICE_MS, else 20 s; 0 turns the rescue off. */
export function firstReplyNoticeMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OMB_FIRST_REPLY_NOTICE_MS?.trim();
  if (!raw) return DEFAULT_FIRST_REPLY_NOTICE_MS;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_FIRST_REPLY_NOTICE_MS;
}

/** What the AI itself sends: any of these means it has answered, however little. */
const AI_OUTPUT = new Set<RuntimeEvent["type"]>(["content.delta", "item.started", "item.updated", "item.completed", "request.opened"]);

export interface FirstReplyRescueDeps {
  store: Pick<Store, "appendMessage" | "patchMessage" | "botByThread" | "bot" | "groupByThread">;
  botForThread(botId: string, threadId: string): BotRecord | null;
  /** The bot speaking in a room thread right now. */
  speaker(threadId: string): { botId: string; name: string; color: string } | undefined;
  /** The instance actually running the thread's turn, when known. */
  runningEngine(threadId: string): string | undefined;
  engineName(instanceId: string): string;
  /** A turn nobody watches live (the harness's own upkeep, a routine run) gets no notice. */
  quiet(threadId: string): boolean;
}

interface Watch {
  turnId: string;
  timer: ReturnType<typeof setTimeout> | null;
  /** waiting: nothing from the AI yet; posted: the notice is up; over: nothing more to do this turn. */
  phase: "waiting" | "posted" | "over";
  row: { messageId: string; rescue: FirstReplyRescue } | null;
}

export function createFirstReplyRescue(deps: FirstReplyRescueDeps): { onEvent(event: RuntimeEvent): void } {
  const watches = new Map<string, Watch>();

  const pause = (watch: Watch) => {
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = null;
  };
  const arm = (threadId: string, watch: Watch) => {
    pause(watch);
    const ms = firstReplyNoticeMs();
    if (ms <= 0) return;
    watch.timer = setTimeout(() => post(threadId, watch), ms);
    watch.timer.unref?.();
  };

  const post = (threadId: string, watch: Watch) => {
    watch.timer = null;
    if (watch.phase !== "waiting" || watches.get(threadId) !== watch) return;
    watch.phase = "over";
    if (deps.quiet(threadId)) return;
    const speaker = deps.speaker(threadId);
    const group = speaker ? deps.store.groupByThread(threadId) : undefined;
    const owner = speaker ? deps.store.bot(speaker.botId) : deps.store.botByThread(threadId);
    const bot = owner && !group ? deps.botForThread(owner.id, threadId) ?? owner : owner;
    if (!bot) return;
    const instanceId = deps.runningEngine(threadId) ?? bot.modelSelection.instanceId;
    const ai = deps.engineName(instanceId);
    const rescue: FirstReplyRescue = { botId: bot.id, threadId, instanceId, ai, ...(group ? { groupId: group.id } : {}) };
    const row = deps.store.appendMessage(threadId, {
      role: "bot", kind: "activity", turnId: watch.turnId,
      ...(speaker && group ? { from: { botId: speaker.botId, name: speaker.name, color: speaker.color } } : {}),
      tool: { name: firstReplyWaitingName(bot.name, ai), ok: true, rescue },
    });
    watch.row = { messageId: row.id, rescue };
    watch.phase = "posted";
  };

  const settle = (threadId: string, watch: Watch) => {
    if (!watch.row) return;
    const rescue: FirstReplyRescue = { ...watch.row.rescue, settled: true };
    deps.store.patchMessage(threadId, watch.row.messageId, { tool: { name: firstReplySettledName(rescue.ai), ok: true, rescue } });
  };

  return {
    onEvent(event) {
      const watch = watches.get(event.threadId);
      if (event.type === "turn.started") {
        // A relaunch of the same turn keeps its watch: one notice per turn.
        if (!event.turnId || watch?.turnId === event.turnId) return;
        if (watch) pause(watch);
        const next: Watch = { turnId: event.turnId, timer: null, phase: "waiting", row: null };
        watches.set(event.threadId, next);
        arm(event.threadId, next);
        return;
      }
      if (!watch || (event.turnId !== undefined && event.turnId !== watch.turnId)) return;
      if (AI_OUTPUT.has(event.type)) {
        pause(watch);
        if (watch.phase === "posted") settle(event.threadId, watch);
        watch.phase = "over";
        return;
      }
      switch (event.type) {
        case "runtime.error":
          // The error row says what went wrong; a posted notice keeps its buttons beside it.
          pause(watch);
          watch.phase = "over";
          return;
        case "turn.wait_started":
          // Waiting for the computer is not the AI's silence.
          pause(watch);
          return;
        case "turn.wait_ended":
          if (watch.phase === "waiting") arm(event.threadId, watch);
          return;
        case "turn.completed":
          pause(watch);
          watches.delete(event.threadId);
          return;
        default:
          return;
      }
    },
  };
}
