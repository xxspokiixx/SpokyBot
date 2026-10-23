// "Switch AI" on the first-reply rescue. A bot's AI cannot change mid-turn, so the silent turn stops first; the
// person then lands where this bot's AI is chosen (the bot panel's model picker in Simple mode, the chat header's
// model chip in Advanced mode), and the picker opens by itself as soon as the stop lets it.
import { openBotSettings } from "@/components/bot-panel/panel-link";
import type { Action } from "@/state/store";
import type { FirstReplyRescue } from "../../shared/first-reply-rescue";

const PICKER_POLL_MS = 100;
const PICKER_WAIT_MS = 10_000;

export function switchAi(
  dispatch: (action: Action) => void,
  rescue: FirstReplyRescue,
  options: { busy: boolean; advanced: boolean },
): void {
  if (options.busy) {
    dispatch(rescue.groupId
      ? { type: "interruptGroup", groupId: rescue.groupId, threadId: rescue.threadId }
      : { type: "interrupt", botId: rescue.botId, threadId: rescue.threadId });
  }
  // A room has no model chip in its header: its bot's settings hold the picker in either mode.
  const header = options.advanced && !rescue.groupId;
  if (!header) openBotSettings(dispatch, "model", { botId: rescue.botId });
  openPickerWhenReady(header ? '[data-chathead-controls] [data-tour="model"]' : '[data-panel-row="model"] [data-tour="model"], [data-tour="model"]');
}

/** Clicks the picker's trigger once it is drawn and enabled (it is disabled while the bot works), at most once. */
function openPickerWhenReady(selector: string): void {
  const started = Date.now();
  const timer = setInterval(() => {
    const trigger = document.querySelector<HTMLButtonElement>(selector);
    if (trigger && !trigger.disabled) {
      clearInterval(timer);
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    } else if (Date.now() - started >= PICKER_WAIT_MS) {
      clearInterval(timer);
    }
  }, PICKER_POLL_MS);
}
