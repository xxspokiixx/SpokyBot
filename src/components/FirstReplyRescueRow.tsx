import { Info } from "lucide-react";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { switchAi } from "@/lib/switch-ai";
import { useStore } from "@/state/store";
import type { FirstReplyRescue } from "../../shared/first-reply-rescue";

const pill = "rounded-full border border-hairline/40 px-2.5 py-1 text-[12.5px] text-ink hover:bg-raised";

/** A first reply that has not come: who is waiting on which AI, and two ways out. A quiet notice, never an error;
 * it goes once the AI starts answering. `text` is the row's stored sentence, for a bot this client no longer has. */
export function FirstReplyRescueRow({ rescue, text }: { rescue: FirstReplyRescue; text: string }) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  if (rescue.settled) return null;
  const bot = state.bots.find((candidate) => candidate.id === rescue.botId);
  const ai = state.instances.find((instance) => instance.instanceId === rescue.instanceId)?.displayName || rescue.ai;
  const task = bot?.tasks?.find((candidate) => candidate.threadId === rescue.threadId);
  const busy = rescue.groupId
    ? state.groups.find((group) => group.id === rescue.groupId)?.busyBotId === rescue.botId
    : Boolean(task ? task.busy : bot?.threadId === rescue.threadId && bot.busy);
  return (
    <div role="status" data-first-reply-rescue className="flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
      <span className="flex min-w-0 items-start gap-2">
        <Info size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">{bot ? t("chat.rescue.waiting", { bot: bot.name, ai }) : text}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className={pill} title={t("chat.rescue.switchAiHint", { bot: bot?.name ?? "" })}
          onClick={() => switchAi(dispatch, rescue, { busy, advanced })}>
          {t("chat.rescue.switchAi")}
        </button>
        <button type="button" className={pill} title={t("chat.rescue.connectHint")}
          onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "engines" })}>
          {t("chat.rescue.connect")}
        </button>
      </span>
    </div>
  );
}
