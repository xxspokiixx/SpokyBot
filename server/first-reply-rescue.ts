// The first-reply rescue, for every engine: a turn whose AI has sent nothing at all (no text, thinking, tool call
// or progress) some seconds after it started gets one notice in its chat, which the desktop draws with "Switch AI"
// and "Connect your subscription". The notice settles once the AI's first output arrives, and is over (history,
// no live buttons) once its turn ends without one. Silence later in a turn stays the engine's own business (the ACP
// quiet watch speaks at 60 s and 180 s).
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

/** What the AI itself sends, live progress included: any of these means it has answered, however little. */
const AI_OUTPUT = new Set<RuntimeEvent["type"]>([
  "content.delta", "item.started", "item.updated", "item.completed", "request.opened", "turn.progress",
]);

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
  /** Whether this turn is still the one the thread is running: its end can be lost (a stop during the handshake,
   * a turn the harness retired), and a notice for a turn that is gone would be a lie. */
  live(threadId: string, turnId: string): boolean;
  /** Who asked for each thread's running turn: the person's message it answers, when the harness knows it. */
  requests: { get(threadId: string): { messageId?: string; stopped?: boolean; turnId: string | null } | undefined };
}

interface Watch {
  turnId: string;
  timer: ReturnType<typeof setTimeout> | null;
  /** waiting: nothing from the AI yet; posted: the notice is up; over: nothing more to do this turn. */
  phase: "waiting" | "posted" | "over";
  row: { messageId: string; name: string; rescue: FirstReplyRescue } | null;
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
    watch.timer = setTimeout(() => {
      watch.timer = null;
      try { post(threadId, watch); } catch (error) {
        console.error(`first-reply rescue: could not post in ${threadId}:`, error instanceof Error ? error.message : error);
      }
    }, ms);
    watch.timer.unref?.();
  };

  const post = (threadId: string, watch: Watch) => {
    if (watch.phase !== "waiting" || watches.get(threadId) !== watch) return;
    watch.phase = "over";
    if (deps.quiet(threadId) || !deps.live(threadId, watch.turnId)) return;
    const speaker = deps.speaker(threadId);
    const group = speaker ? deps.store.groupByThread(threadId) : undefined;
    const owner = speaker ? deps.store.bot(speaker.botId) : deps.store.botByThread(threadId);
    const bot = owner && !group ? deps.botForThread(owner.id, threadId) ?? owner : owner;
    if (!bot) return;
    const instanceId = deps.runningEngine(threadId) ?? bot.modelSelection.instanceId;
    const ai = deps.engineName(instanceId);
    const request = group ? undefined : deps.requests.get(threadId);
    const requestMessageId = request && !request.stopped && request.turnId === watch.turnId ? request.messageId : undefined;
    const rescue: FirstReplyRescue = {
      botId: bot.id, threadId, turnId: watch.turnId, ...(requestMessageId ? { requestMessageId } : {}), instanceId, ai,
      ...(group ? { groupId: group.id } : {}),
    };
    const name = firstReplyWaitingName(bot.name, ai);
    const row = deps.store.appendMessage(threadId, {
      role: "bot", kind: "activity", turnId: watch.turnId,
      ...(speaker && group ? { from: { botId: speaker.botId, name: speaker.name, color: speaker.color } } : {}),
      tool: { name, ok: true, rescue },
    });
    watch.row = { messageId: row.id, name, rescue };
    watch.phase = "posted";
  };

  /** The AI answered (`settled`) or the turn ended without an answer (`over`): either way the row asks nothing now. */
  const close = (threadId: string, watch: Watch, how: "settled" | "over") => {
    pause(watch);
    const posted = watch.phase === "posted" ? watch.row : null;
    watch.phase = "over";
    if (!posted) return;
    const rescue: FirstReplyRescue = { ...posted.rescue, [how]: true };
    // An over row keeps its words for the clients that print them; a settled one says the AI answered.
    const name = how === "settled" ? firstReplySettledName(rescue.ai) : posted.name;
    try {
      deps.store.patchMessage(threadId, posted.messageId, { tool: { name, ok: true, rescue } });
    } catch (error) {
      console.error(`first-reply rescue: could not close the notice in ${threadId}:`, error instanceof Error ? error.message : error);
    }
  };

  return {
    onEvent(event) {
      const watch = watches.get(event.threadId);
      if (event.type === "turn.started") {
        // A relaunch of the same turn keeps its watch: one notice per turn.
        if (!event.turnId || watch?.turnId === event.turnId) return;
        if (watch) close(event.threadId, watch, "over");
        const next: Watch = { turnId: event.turnId, timer: null, phase: "waiting", row: null };
        watches.set(event.threadId, next);
        arm(event.threadId, next);
        return;
      }
      if (!watch || (event.turnId !== undefined && event.turnId !== watch.turnId)) return;
      if (AI_OUTPUT.has(event.type)) {
        close(event.threadId, watch, "settled");
        return;
      }
      switch (event.type) {
        case "runtime.error":
          // The error row says what went wrong; the notice is history beside it.
          close(event.threadId, watch, "over");
          return;
        case "turn.wait_started":
          // Waiting for the computer is not the AI's silence.
          pause(watch);
          return;
        case "turn.wait_ended":
          if (watch.phase === "waiting") arm(event.threadId, watch);
          return;
        case "turn.completed":
          close(event.threadId, watch, "over");
          watches.delete(event.threadId);
          return;
        default:
          return;
      }
    },
  };
}
