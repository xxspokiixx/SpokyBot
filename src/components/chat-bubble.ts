import { cn } from "@/lib/cn";

const SIMPLE_BUBBLE_SHAPE = "rounded-[18px] px-3 py-[7px] text-[14px] leading-[22px]";

/** Simple mode's bot bubble: the one surface tone. */
export const SIMPLE_BOT_BUBBLE = `${SIMPLE_BUBBLE_SHAPE} bg-card text-ink`;

/** At most 560 wide, 80% of the column, and always 82px short of it, so a reply never meets the far edge. */
export const SIMPLE_BUBBLE_MAX = "max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct),calc(100%-82px))]";

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
