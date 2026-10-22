import { AppWindow } from "lucide-react";
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { usePreviewState } from "@/lib/preview-pane";
import type { AppPayload } from "../../shared/app";
import { AppMessage } from "./app/AppMessage";
import { PageCard } from "./preview/PageCard";
import { MessageBoundary } from "./MessageBoundary";
import { WidgetMessage } from "./widget/WidgetMessage";

export function richRowKind(message: Message): Message["kind"] {
  if (message.kind === "widget" && !message.widget) return "text";
  if (message.kind === "app" && !message.app) return "text";
  return message.kind;
}

export function RichMessageRow({ botId, botName, threadId, message }: { botId: string; botName: string; threadId?: string; message: Message }) {
  const { hosts } = usePreviewState();
  const page = message.kind === "app" && message.app?.source === "html" && hosts > 0 && threadId ? message as Message & { app: AppPayload } : null;
  return (
    <MessageBoundary fallbackText={message.text ?? ""}>
      {page && threadId ? <PageCard botId={botId} botName={botName} threadId={threadId} message={page} />
        : message.kind === "app"
          ? <AppMessage botId={botId} botName={botName} threadId={threadId} message={message} />
          : <WidgetMessage botId={botId} threadId={threadId} message={message} />}
    </MessageBoundary>
  );
}

export function UserLineNote({ message }: { message: Message }) {
  if (message.fromApp?.title) {
    const label = t("app.sentFrom", { title: message.fromApp.title });
    return (
      <span data-sent-from-app={message.fromApp.messageId} className="mt-1 flex items-center gap-1 text-[11px] text-ink-tertiary" title={label}>
        <AppWindow aria-hidden="true" size={11} className="shrink-0" />
        <bdi dir="auto" className="min-w-0 truncate">{label}</bdi>
      </span>
    );
  }
  if (message.via !== "call") return null;
  return <span className="mt-1 text-[11px] text-ink-tertiary" title={t("chat.viaCall")}>{t("chat.viaCall")}</span>;
}
