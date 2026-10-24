import { Flag } from "lucide-react";

import type { ThreadGoal } from "../../shared/bot-goal";
import { goalSay, sendGoalRequest } from "@/lib/bot-goal";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";

export type GoalChipAction = "pause" | "resume" | "clear";

const button = "flex h-7 shrink-0 items-center rounded-lg px-2 text-[13px] font-medium text-ink-secondary outline-none hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60";

export function goalChipLabel(goal: ThreadGoal): string {
  if (goal.status === "active") return t("goal.active", { turns: goal.turns, max: goal.maxTurns });
  if (goal.status === "complete") return t("goal.complete");
  return goal.reason ? `${t("goal.paused")}: ${t(`goal.reason.${goal.reason}`)}` : t("goal.paused");
}

export function BotGoalChip({ goal, onAct }: { goal: ThreadGoal; onAct: (action: GoalChipAction) => void }) {
  return (
    <div
      className="relative z-[1] mx-3 -mb-3 flex items-center gap-2 rounded-t-2xl border border-b-0 border-hairline/40 bg-raised/95 px-2.5 pb-3 pt-1.5 shadow-sm backdrop-blur-sm"
      role="region"
      aria-label={t("goal.region")}
      aria-live="polite"
    >
      <Flag size={14} strokeWidth={1.8} className="shrink-0 text-ink-secondary" aria-hidden="true" />
      <span dir="auto" className="min-w-0 flex-1 truncate text-[14px] text-ink" title={goal.text}>
        <span className="font-medium">{goalChipLabel(goal)}</span>
        <span className="text-ink-secondary"> · {goal.text}</span>
      </span>
      {goal.status === "active" && <button type="button" className={button} onClick={() => onAct("pause")}>{t("goal.pause")}</button>}
      {goal.status === "paused" && <button type="button" className={button} onClick={() => onAct("resume")}>{t("goal.resume")}</button>}
      <button type="button" className={button} onClick={() => onAct("clear")}>{t("goal.clear")}</button>
    </div>
  );
}

/** The goal of this bot conversation above the composer, with the controls that change it. */
export function BotGoalLine({ bot, threadId, dispatch }: { bot?: Bot; threadId: string; dispatch: Parameters<typeof goalSay>[0] }) {
  const goal = bot?.tasks?.find((task) => task.threadId === threadId)?.goal;
  if (!bot || !goal) return null;
  return <BotGoalChip goal={goal} onAct={(action) => void sendGoalRequest(bot.id, threadId, { action }).then((failure) => failure && goalSay(dispatch)({ text: failure, error: true }))} />;
}
