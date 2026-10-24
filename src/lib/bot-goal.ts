import { api, ApiError } from "@/state/api";
import { t } from "@/lib/i18n";
import type { Action } from "@/state/store";
import { parseGoalCommand, type GoalCommand, type ThreadGoal } from "../../shared/bot-goal";

export type GoalRequest = { action: "set"; text: string } | { action: "pause" | "resume" | "clear" };
type Dispatch = (action: Action) => void;

export const goalSay = (dispatch: Dispatch) => ({ text, error }: { text: string; error: boolean }): void =>
  dispatch(error ? { type: "error", message: text } : { type: "notice", notice: { kind: "note", botName: null, text } });

export function goalCommandEffect(command: GoalCommand, goal: ThreadGoal | undefined): { request: GoalRequest } | { notice: string } {
  if (command.kind === "show") return { notice: goal ? t("goal.shown", { text: goal.text }) : t("goal.none") };
  if (command.kind === "set") return { request: { action: "set", text: command.text } };
  return { request: { action: command.kind } };
}

export async function sendGoalRequest(botId: string, threadId: string, request: GoalRequest): Promise<string | null> {
  try {
    await api(`/api/bots/${botId}/goal`, { method: "POST", body: JSON.stringify({ threadId, ...request }) });
    return null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return t("goal.mainApp");
    return t("goal.failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

/** Runs a typed `/goal`; false when the text is not one. */
export function runGoalCommand(text: string, target: { botId: string; threadId: string; goal: ThreadGoal | undefined }, dispatch: Dispatch): boolean {
  const command = parseGoalCommand(text);
  if (!command) return false;
  const say = goalSay(dispatch);
  const effect = goalCommandEffect(command, target.goal);
  if ("notice" in effect) say({ text: effect.notice, error: false });
  else void sendGoalRequest(target.botId, target.threadId, effect.request).then((failure) => failure && say({ text: failure, error: true }));
  return true;
}
