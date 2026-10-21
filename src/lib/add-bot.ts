import { leadComposerDraft } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { readAdvancedMode } from "@/lib/interface-mode";
import type { Action, Bot } from "@/state/store";
import { botOpensTo, openBot } from "@/state/thread-navigation";

/** Who a Simple-mode person asks for a new bot: the visible Chief of Staff, General's before a team's. */
export function addBotChief(bots: readonly Bot[]): Bot | undefined {
  const chiefs = bots.filter((bot) => bot.chiefOfStaff && !bot.hidden);
  return chiefs.find((bot) => !bot.section?.trim()) ?? chiefs[0];
}

/** Advanced mode opens the New bot form. Simple mode hands the job to the Chief: its chat opens with a short starter in
 * the composer, and the Chief adds the bot. Without a Chief the form opens in both modes. */
export function addBot(dispatch: (action: Action) => void, bots: readonly Bot[], threadsShown: boolean, advanced = readAdvancedMode()): void {
  const chief = advanced ? undefined : addBotChief(bots);
  if (!chief) {
    dispatch({ type: "toggleNewBot", open: true });
    return;
  }
  const threadId = botOpensTo(chief, threadsShown);
  openBot(dispatch, chief, threadsShown);
  leadComposerDraft(`bot:${chief.id}:${threadId}`, t("chief.addBotStarter"));
  globalThis.requestAnimationFrame?.(() => globalThis.document?.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.focus());
}
