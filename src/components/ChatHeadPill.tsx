import { Lock, Users } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { ELEVATED_FLOAT, ELEVATED_HOVER } from "./elevated";
import { sidebarBotActivityTasks } from "./SidebarBotActivity";

export type ChatHeadPrivacy = { kind: "private" } | { kind: "shared"; team: string } | null;

/** Simple mode's whole chat header: the bot's face and name in one pill, which opens the bot panel. A dot says another
 * of the bot's conversations needs a look; a team chat says who can read it with one quiet glyph. */
export function ChatHeadPill({ bot, avatar, privacy, onOpen }: {
  bot: Bot;
  avatar: Pick<ComponentProps<typeof BotAvatar>, "state" | "motion" | "motionKey" | "animated">;
  privacy: ChatHeadPrivacy;
  onOpen: () => void;
}) {
  const { state } = useStore();
  const elsewhere = sidebarBotActivityTasks(bot, state.pendingQueued).filter((task) => task.threadId !== bot.threadId).length;
  const privacyLabel = privacy?.kind === "private" ? t("team.privateHeader")
    : privacy?.kind === "shared" ? t("team.sharedHeader", { team: privacy.team }) : null;
  const PrivacyIcon = privacy?.kind === "private" ? Lock : Users;
  return (
    <button
      type="button"
      data-chathead-pill
      data-tour="bot-pill"
      onClick={onOpen}
      title={t("chat.openProfile")}
      aria-label={t("chat.openProfileAria", { name: bot.name })}
      className={cn("flex min-w-0 max-w-full items-center gap-2 rounded-full py-[7.5px] pl-[7.5px] pr-[13.5px] text-ink", ELEVATED_FLOAT, ELEVATED_HOVER)}
    >
      <BotAvatar bot={bot} size={24} {...avatar} />
      <span dir="auto" className="min-w-0 truncate text-[14px] font-medium leading-5">{bot.name}</span>
      {privacyLabel && (
        <span data-chathead-privacy={privacy?.kind} title={privacyLabel} className="flex shrink-0 text-ink-tertiary">
          <PrivacyIcon size={13} aria-hidden="true" />
          <span className="sr-only">{privacyLabel}</span>
        </span>
      )}
      {elsewhere > 0 && (
        <span role="img" data-chathead-elsewhere aria-label={t("task.otherActivity", { count: elsewhere })} className="size-1.5 shrink-0 rounded-full bg-accent" />
      )}
    </button>
  );
}
