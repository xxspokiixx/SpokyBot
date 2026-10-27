import { cn } from "@/lib/cn";
import { failedTurnCause } from "@/lib/failed-turn";
import { isStatusActivity } from "@/lib/activity-runs";
import { peerLine, peerRequest } from "@/lib/peer-message";
import type { Message } from "@/state/store";
import { isPureLeakedSystemHarnessMessage } from "../../shared/system-message-guard.ts";

const SIMPLE_BUBBLE_SHAPE = "rounded-[18px] px-3 py-[7px] text-[14px] leading-[22px]";

/** Simple mode's bot bubble: the one surface tone. */
export const SIMPLE_BOT_BUBBLE = `${SIMPLE_BUBBLE_SHAPE} bg-card text-ink`;

/** Simple mode's own bubble; the bot's colour, when on, comes from its inline style. */
export const SIMPLE_USER_BUBBLE = `${SIMPLE_BUBBLE_SHAPE} bg-bubble-user font-normal`;

/** At most 560 wide, 80% of the column, and always 82px short of it, so a reply never meets the far edge. */
export const SIMPLE_BUBBLE_MAX = "max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct),calc(100%-82px))]";

/** Simple mode's transcript spaces rows 16px apart (ChatView's data-simple-rows); a row in the same group pulls up 12px, to 4px. */
export const SIMPLE_STACKED = "-mt-3";

/** Where a Simple bubble meets its group's neighbours: those corners tighten to 6px on the bubble's own side. */
export interface BubbleJoin {
  above: boolean;
  below: boolean;
}

export function joinedCorners(side: "start" | "end", join: BubbleJoin): string {
  return cn(
    join.above && (side === "start" ? "rounded-ss-[6px]" : "rounded-se-[6px]"),
    join.below && (side === "start" ? "rounded-es-[6px]" : "rounded-ee-[6px]"),
  );
}

/** Which bubble group a transcript row belongs to in Simple mode: this bot's words, the person's own words, or none. */
export function bubbleGroup(message: Message, botId: string): "bot" | "user" | null {
  if (message.kind !== "text" || message.publishedPage || message.automation) return null;
  if (message.role === "user") return peerLine(message) ? null : "user";
  if (message.role !== "bot" || peerRequest(message, botId)) return null;
  return isPureLeakedSystemHarnessMessage(message.text) && !message.attachments?.length ? null : "bot";
}

export function isBotTextRow(message: Message, botId: string): boolean {
  return bubbleGroup(message, botId) === "bot";
}

/** A transcript row that draws nothing: a reaction, or a tool step or work summary while tool calls are hidden. */
export function quietRow(message: Message, showToolCalls: boolean): boolean {
  if (message.reaction) return true;
  if (message.kind === "digest") return !showToolCalls;
  if (message.kind !== "activity" || showToolCalls) return false;
  if (message.dataResult || message.comm || message.threadRef || message.relay || isStatusActivity(message)) return false;
  return !(message.tool && failedTurnCause(message.tool.name) !== null);
}

export interface TranscriptSlot {
  /** The bubble group this row joins, or null for a row that is no bubble (a card, a chip, a separator line). */
  group: "bot" | "user" | null;
  /** The row draws nothing, so it neither joins nor breaks a group. */
  hidden: boolean;
  /** Something stands between this row and the one above it: a day stamp, the unread line, a caption. */
  breakBefore: boolean;
  /** Something follows this row before the next one: an offer card. */
  breakAfter: boolean;
}

/** Each row's joins to its neighbours: a bubble joins the nearest drawn row on either side when that row is a bubble
 * of the same group and nothing stands between them. */
export function bubbleJoins(slots: readonly TranscriptSlot[]): BubbleJoin[] {
  const shown = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => !slot.hidden);
  const joins: BubbleJoin[] = slots.map(() => ({ above: false, below: false }));
  for (let at = 1; at < shown.length; at++) {
    const upper = shown[at - 1]!;
    const lower = shown[at]!;
    if (!upper.slot.group || upper.slot.group !== lower.slot.group || upper.slot.breakAfter || lower.slot.breakBefore) continue;
    joins[upper.index]!.below = true;
    joins[lower.index]!.above = true;
  }
  return joins;
}
