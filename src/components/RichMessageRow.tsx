// The transcript's bot-authored rich rows: a widget (a UI tree drawn
// natively, src/components/widget) and an app (HTML in a sandboxed frame,
// src/components/app). Both are persisted bot output, so one that throws
// while drawing falls back to its text, and a row whose payload never
// arrived reads as its text. ChatView hands both kinds here.
import { AppWindow } from "lucide-react";
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { AppMessage } from "./app/AppMessage";
import { MessageBoundary } from "./MessageBoundary";
import { WidgetMessage } from "./widget/WidgetMessage";

/** The kind ChatView draws a row as: a widget or app row without its
 * payload is plain text. */
export function richRowKind(message: Message): Message["kind"] {
  if (message.kind === "widget" && !message.widget) return "text";
  if (message.kind === "app" && !message.app) return "text";
  return message.kind;
}

export function RichMessageRow({ botId, botName, threadId, message }: { botId: string; botName: string; threadId?: string; message: Message }) {
  return (
    <MessageBoundary fallbackText={message.text ?? ""}>
      {message.kind === "app"
        ? <AppMessage botId={botId} botName={botName} threadId={threadId} message={message} />
        : <WidgetMessage botId={botId} threadId={threadId} message={message} />}
    </MessageBoundary>
  );
}

/** The small line under the person's own words that did not come from
 * typing here: spoken on a Live call, or sent by an app in this chat. */
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
