import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Copy, Globe, Loader2, Upload, X } from "lucide-react";
import { visibleMessages, useStore, type Bot, type Message } from "@/state/store";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { closePreview, hostPreview, openPreview, usePreviewState } from "@/lib/preview-pane";
import type { AppDocument, AppPayload } from "../../../shared/app";
import type { PublishedPageCard } from "../../../shared/published-page";
import { AppDocumentError, fetchAppDocument, fetchAppPagePublished, publishAppPage, type AppFetchFailure } from "../app/app-api";
import { AppPlaceholder } from "../app/AppChrome";
import { AppFrame, type AppFrameHandle } from "../app/AppFrame";
import { ASK_CHIP, ASK_CHIP_IDLE, ASK_PRIMARY_BUTTON } from "../AskCard";

const FLASH_MS = 2_500;
const ICON_BUTTON =
  "flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40";

type BotPage = Message & { app: AppPayload };

export function isBotPage(message: Message): message is BotPage {
  return message.kind === "app" && message.role === "bot" && Boolean(message.app) && message.app!.source === "html" && typeof message.app!.doc === "string";
}

/** The oldest version a row's page still keeps, and its current one. */
export function pageVersions(app: AppPayload): { first: number; last: number } {
  const last = app.rev ?? 0;
  return { first: Math.max(0, last - (app.history?.length ?? 0)), last };
}

/** A page that arrives in the open conversation opens the pane; pages already there when it was opened, and older
 * ones loaded on scrolling back, stay cards. */
export function useAutoPreview(bot: Bot | undefined): void {
  const seen = useRef(new Map<string, { ids: Set<string>; since: number }>());
  const ready = Boolean(bot && !bot.awaitingThreadSnapshot);
  useEffect(() => {
    if (!bot || !ready) return;
    const rows = visibleMessages(bot);
    const pages = rows.filter(isBotPage);
    const known = seen.current.get(bot.threadId);
    if (!known) {
      seen.current.set(bot.threadId, { ids: new Set(pages.map((page) => page.id)), since: Math.max(0, ...rows.map((row) => row.at ?? 0)) });
      return;
    }
    const fresh = pages.filter((page) => !known.ids.has(page.id) && (page.at ?? 0) >= known.since);
    for (const page of pages) known.ids.add(page.id);
    const newest = fresh.at(-1);
    if (newest) openPreview({ botId: bot.id, threadId: bot.threadId, messageId: newest.id });
  }, [bot, ready]);
}

/** Mounted once beside the chat: bot pages draw as cards that open here. */
export function PreviewPaneHost({ bot }: { bot: Bot | undefined }) {
  useEffect(() => hostPreview(), []);
  useAutoPreview(bot);
  const { target } = usePreviewState();
  if (!bot || !target || target.botId !== bot.id || target.threadId !== bot.threadId) return null;
  const message = bot.messages.find((candidate) => candidate.id === target.messageId);
  if (!message || !isBotPage(message)) return null;
  return <PreviewPane key={`${target.threadId}:${target.messageId}`} bot={bot} message={message} />;
}

type Shown = { key: string; doc: AppDocument } | { key: string; failure: AppFetchFailure };
type PublishState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "live"; url: string; again: boolean }
  | { kind: "refused"; text: string; card?: PublishedPageCard };

function blobPage(title: string, srcdoc: string): string {
  const attribute = srcdoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const name = title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${name}</title><style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" srcdoc="${attribute}"></iframe></body></html>`;
}

export function PreviewPane({ bot, message }: { bot: Bot; message: BotPage }) {
  const { dispatch } = useStore();
  const { padClass, dragProps } = useCaptionChrome();
  const app = message.app;
  const threadId = bot.threadId;
  const { first, last } = pageVersions(app);
  const [viewing, setViewing] = useState<number | null>(null);
  const rev = viewing === null ? last : Math.min(last, Math.max(first, viewing));
  const [shown, setShown] = useState<Shown | null>(null);
  const [flash, setFlash] = useState(false);
  const [publish, setPublish] = useState<PublishState>({ kind: "idle" });
  const frame = useRef<AppFrameHandle | null>(null);
  const lastRev = useRef(last);
  const live = publish.kind === "live" ? publish : null;
  const { state: copied, copy } = useCopyFeedback(live?.url ?? "");
  const desktop = Boolean(window.ogb);

  useEffect(() => {
    if (last > lastRev.current) {
      setViewing(null);
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), FLASH_MS);
      lastRev.current = last;
      return () => clearTimeout(timer);
    }
    lastRev.current = last;
    return undefined;
  }, [last]);

  const key = `${message.id}:${rev}:${rev === last ? app.doc : "kept"}`;
  useEffect(() => {
    if (!app.doc) return;
    const controller = new AbortController();
    fetchAppDocument(threadId, message.id, controller.signal, rev === last ? undefined : rev).then(
      (doc) => { if (!controller.signal.aborted) setShown({ key, doc }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setShown({ key, failure: error instanceof AppDocumentError ? error.failure : { offline: true } });
      },
    );
    return () => controller.abort();
  }, [key, threadId, message.id, rev, last, app.doc]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAppPagePublished(threadId, message.id, controller.signal).then(
      (published) => { if (published && !controller.signal.aborted) setPublish((now) => (now.kind === "idle" ? { kind: "live", url: published.url, again: false } : now)); },
      () => {},
    );
    return () => controller.abort();
  }, [threadId, message.id]);

  const doPublish = async () => {
    setPublish({ kind: "busy" });
    const again = Boolean(live);
    const outcome = await publishAppPage(threadId, message.id, rev);
    if (outcome.ok && outcome.card.url) setPublish({ kind: "live", url: outcome.card.url, again });
    else setPublish({ kind: "refused", text: outcome.ok ? t("chat.preview.publishFailed") : (outcome.card?.message ?? outcome.error), ...(outcome.ok || !outcome.card ? {} : { card: outcome.card }) });
  };

  const openTab = () => {
    if (live) return void openExternalLink(live.url);
    if (!shown || !("doc" in shown)) return;
    const url = URL.createObjectURL(new Blob([blobPage(app.title, shown.doc.srcdoc)], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const versionLabel = rev === last ? t("chat.preview.version", { n: rev + 1 }) : t("chat.preview.versionOf", { n: rev + 1, count: last + 1 });
  const body = useMemo(() => {
    if (!app.doc) return <AppPlaceholder height={200}><span className="text-[13px] text-ink-secondary">{message.text}</span></AppPlaceholder>;
    if (!shown) return <AppPlaceholder height={200} loading />;
    if ("failure" in shown) {
      return <AppPlaceholder height={200}><span role="status" className="text-[13px] text-ink-secondary">{shown.failure.offline ? t("app.strip.offline") : shown.failure.error}</span></AppPlaceholder>;
    }
    return (
      <AppFrame
        key={shown.key}
        doc={shown.doc}
        botId={bot.id}
        threadId={threadId}
        title={app.title}
        height={400}
        handle={frame}
        onHeight={() => {}}
        onProblem={() => {}}
        onTeardownRequested={closePreview}
        fill
      />
    );
  }, [app.doc, app.title, shown, bot.id, threadId, message.text]);

  return (
    <aside
      aria-label={t("chat.preview.title")}
      data-preview-pane={message.id}
      data-preview-rev={rev}
      className="animate-panel-in absolute inset-0 z-40 flex h-full min-w-0 flex-col border-l border-hairline/40 bg-panel md:static md:z-auto md:w-[min(720px,50vw)] md:shrink-0"
    >
      <div {...dragProps} className={cn("flex items-center gap-2 px-3 py-2.5", padClass)}>
        <div className="min-w-0 flex-1 ps-1">
          <div className="truncate text-[14.5px] font-semibold text-ink" title={app.title}><bdi dir="auto">{app.title}</bdi></div>
          <div className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-secondary">
            <button type="button" className={cn(ICON_BUTTON, "size-5 rounded")} aria-label={t("chat.preview.older")} title={t("chat.preview.older")}
              disabled={rev <= first} onClick={() => setViewing(rev - 1)}><ChevronLeft size={13} /></button>
            <span data-preview-version className="tabular-nums">{versionLabel}</span>
            <button type="button" className={cn(ICON_BUTTON, "size-5 rounded")} aria-label={t("chat.preview.newer")} title={t("chat.preview.newer")}
              disabled={rev >= last} onClick={() => setViewing(rev + 1 >= last ? null : rev + 1)}><ChevronRight size={13} /></button>
            {rev < last && <button type="button" className="ms-1 rounded px-1 text-accent-text hover:underline" onClick={() => setViewing(null)}>{t("chat.preview.latest")}</button>}
            {flash && <span role="status" data-preview-updated className="ms-1 rounded-full bg-accent/15 px-2 py-px font-medium text-accent-text motion-safe:animate-pulse">{t("chat.preview.updated")}</span>}
          </div>
        </div>
        <button type="button" className={ICON_BUTTON} onClick={openTab} disabled={!live && (desktop || !shown || !("doc" in shown))}
          aria-label={t("chat.preview.openTab")} title={!live && desktop ? t("chat.preview.openTabNeedsLink") : t("chat.preview.openTab")}>
          <ArrowUpRight size={16} />
        </button>
        <button type="button" className={cn(ASK_PRIMARY_BUTTON, "h-8")} onClick={() => void doPublish()} disabled={publish.kind === "busy" || !app.doc}>
          {publish.kind === "busy" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {live ? t("chat.preview.republish") : t("chat.preview.publish")}
        </button>
        <button type="button" className={ICON_BUTTON} onClick={closePreview} aria-label={t("chat.preview.close")} title={t("chat.preview.close")}>
          <X size={17} />
        </button>
      </div>
      {live && (
        <div data-preview-published className="mx-3 mb-2 flex min-w-0 items-center gap-2 rounded-xl bg-inset px-3 py-2 text-[13px]">
          <Globe size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
          <span className="shrink-0 font-medium text-ink">{live.again ? t("chat.preview.updatedLink") : t("chat.preview.published")}</span>
          <a href={live.url} dir="ltr" onClick={(event) => { event.preventDefault(); void openExternalLink(live.url); }}
            className="min-w-0 flex-1 truncate text-accent-text hover:underline">{live.url}</a>
          <button type="button" onClick={copy} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>
            {copied === "copied" ? <Check size={14} /> : <Copy size={14} />}{t(copied === "copied" ? "chat.page.copied" : "chat.page.copyLink")}
          </button>
        </div>
      )}
      {publish.kind === "refused" && (
        <div role="alert" className="mx-3 mb-2 flex items-center gap-2 rounded-xl bg-inset px-3 py-2 text-[13px] text-ink-secondary">
          <span dir="auto" className="min-w-0 flex-1">{publish.text}</span>
          {publish.card?.upgrade && window.ogb?.cloudAccount && !window.ogb.remoteClient?.active && (
            <button type="button" className={ASK_PRIMARY_BUTTON} onClick={() => dispatch({ type: "openCloudAdd", source: "app_pages" })}>{t("chat.page.morePages")}</button>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden border-t border-hairline/40 bg-app">
        {body}
      </div>
    </aside>
  );
}
