import { AppWindow, FileText, Globe } from "lucide-react";
import { useMemo } from "react";

import { t } from "@/lib/i18n";
import { usePageOpener } from "@/lib/page-open";
import { SIDEBAR_INLINE, useMediaQuery } from "@/lib/use-media-query";
import { useStore, visibleMessages, type Bot, type Message } from "@/state/store";
import { AttachedFileChip } from "../AttachmentPreview";
import { recentChangedFiles, sharedFileReferences } from "../ComputerFilesPane";
import { Card, CardLabel, NavRow } from "./rows";

export interface LibraryItems {
  pages: Array<{ messageId: string; title: string; url: string }>;
  apps: Array<{ messageId: string; title: string }>;
  shared: Array<NonNullable<ReturnType<ReturnType<typeof sharedFileReferences>["get"]>>>;
  unshared: string[];
}

/** What the bot made in the open conversation, newest first: its live published pages, its apps, and its files. */
export function libraryItems(bot: Bot, messages: readonly Message[] = visibleMessages(bot)): LibraryItems {
  const pages: LibraryItems["pages"] = [];
  const apps: LibraryItems["apps"] = [];
  const seenPages = new Set<string>();
  for (const message of [...messages].reverse()) {
    const page = message.publishedPage;
    if (page?.state === "live" && page.url && !seenPages.has(page.url)) {
      seenPages.add(page.url);
      pages.push({ messageId: message.id, title: page.title || page.url, url: page.url });
    }
    if (message.kind === "app" && message.app?.doc) apps.push({ messageId: message.id, title: message.app.title });
  }
  const references = sharedFileReferences(bot);
  const shared: LibraryItems["shared"] = [];
  const seenFiles = new Set<string>();
  for (const reference of references.values()) {
    if (seenFiles.has(reference.file.path)) continue;
    seenFiles.add(reference.file.path);
    shared.push(reference);
  }
  const unshared = recentChangedFiles(bot).filter((path) => !references.has(path));
  return { pages, apps, shared, unshared };
}

const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

export function LibraryTab({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const openPage = usePageOpener();
  const phone = !useMediaQuery(SIDEBAR_INLINE, true);
  const { pages, apps, shared, unshared } = useMemo(() => libraryItems(bot), [bot]);
  const showInChat = (messageId: string) => {
    dispatch({ type: "focusMessage", threadId: bot.threadId, messageId });
    if (phone) dispatch({ type: "toggleSettings", open: false });
  };

  if (pages.length + apps.length + shared.length + unshared.length === 0) {
    return (
      <div data-panel-tabpanel="library">
        <p data-panel-empty="library" className="mx-auto mt-6 max-w-[264px] text-center text-[13px] leading-[18px] text-ink-secondary">
          {t("botPanel.library.empty")}
        </p>
      </div>
    );
  }
  return (
    <div data-panel-tabpanel="library">
      {pages.length > 0 && (
        <Card label={t("botPanel.library.pages")} anchor="pages">
          {pages.map((page) => (
            <NavRow key={page.url} data-panel-row="page" icon={Globe} title={<span className="block truncate">{page.title}</span>} hint={<span className="block truncate">{page.url}</span>} onClick={() => openPage(page.url)} />
          ))}
        </Card>
      )}
      {apps.length > 0 && (
        <Card label={t("botPanel.library.apps")} anchor="apps">
          {apps.map((app) => (
            <NavRow key={app.messageId} data-panel-row="app" icon={AppWindow} title={<span className="block truncate">{app.title}</span>} onClick={() => showInChat(app.messageId)} />
          ))}
        </Card>
      )}
      {shared.length + unshared.length > 0 && (
        <section data-panel-card="files">
          <CardLabel>{t("botPanel.library.files")}</CardLabel>
          <ul className="flex flex-col gap-1.5">
            {shared.map((reference) => (
              <li key={`${reference.message.messageId}:${reference.file.path}`} className="min-w-0">
                <AttachedFileChip file={reference.file} message={reference.message} linked={reference.file.linked} className="w-full max-w-none" />
              </li>
            ))}
            {unshared.map((path) => (
              <li key={path} title={t("computer.files.notSharedHint")} className="flex min-w-0 items-center gap-2 rounded-lg border border-hairline/40 px-2.5 py-2">
                <FileText size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{fileName(path)}</span>
                <span className="shrink-0 text-[11px] text-ink-tertiary">{t("computer.files.notShared")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-3 text-center text-[12px] text-ink-tertiary">{t("botPanel.library.scope")}</p>
    </div>
  );
}
