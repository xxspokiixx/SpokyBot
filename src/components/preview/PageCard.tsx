import { AppWindow } from "lucide-react";
import type { Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { openPreview, usePreviewState } from "@/lib/preview-pane";
import { appBlockedText, type AppPayload } from "../../../shared/app";
import { ASK_CHIP, ASK_CHIP_IDLE, ASK_CHIP_PICKED } from "../AskCard";

/** A bot's page in the transcript while the preview pane shows it beside the chat: its title, version and Open. */
export function PageCard({ botId, botName, threadId, message }: { botId: string; botName: string; threadId: string; message: Message & { app: AppPayload } }) {
  const { target } = usePreviewState();
  const app = message.app;
  const showing = target?.threadId === threadId && target.messageId === message.id;
  const version = (app.rev ?? 0) + 1;
  return (
    <div
      role="group"
      aria-label={t("app.aria.row", { title: app.title })}
      data-page-card={message.id}
      data-app={message.id}
      className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-composer px-3 py-2.5 ring-1 ring-composer-ring"
    >
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inset text-ink-secondary">
        <AppWindow size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold leading-5 text-ink" title={app.title}><bdi dir="auto">{app.title}</bdi></div>
        <div className="truncate text-[12.5px] leading-[18px] text-ink-secondary">
          {app.blocked ? appBlockedText(app.blocked) : t("chat.preview.cardLine", { bot: botName, n: version })}
        </div>
      </div>
      <button
        type="button"
        disabled={!app.doc}
        aria-pressed={showing}
        onClick={() => openPreview({ botId, threadId, messageId: message.id })}
        className={cn(ASK_CHIP, showing ? ASK_CHIP_PICKED : ASK_CHIP_IDLE)}
      >
        {showing ? t("chat.preview.showing") : t("chat.preview.open")}
      </button>
    </div>
  );
}
