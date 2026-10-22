import { join } from "node:path";
import type { PublishedPageCard } from "../../shared/published-page.ts";
import type { ChatApps } from "../chat-apps.ts";
import { createPagesInternalRoutes, createPublishedPageRoutes } from "../routes/published-pages.ts";
import type { Store } from "../store.ts";
import { applyIncludedPagesMessage, pagesAccess, pagesNotOffered } from "./access.ts";
import { createPagesClient } from "./client.ts";
import { createPagePublisher } from "./publisher.ts";
import { PublishedPagesStore } from "./store.ts";

/** Pages bots publish to a link: the bot tools' internal routes, the card's Unpublish, and the desktop's sign-in message. */
export function createPublishedPages(options: {
  dataDir: string;
  /** This server's Cloud home configuration, or null on a desktop or any other server. */
  cloudHome: { adminOrigin: string; machineId: string; bootstrapSecret: string } | null;
  patch: (threadId: string, messageId: string, text: string, card: PublishedPageCard) => void;
  fetch?: typeof fetch;
  /** The chat's pages, for the preview's Publish. */
  apps?: { chat: Pick<ChatApps, "publishablePage">; store: Pick<Store, "botByThread" | "groupByThread" | "appendMessage"> };
}) {
  const store = new PublishedPagesStore(join(options.dataDir, "published-pages.json"));
  const client = createPagesClient({ access: () => pagesAccess(options.cloudHome), notOffered: () => pagesNotOffered(options.cloudHome),
    ...(options.fetch ? { fetch: options.fetch } : {}) });
  const publisher = createPagePublisher({ client, store, patch: options.patch });
  const apps = options.apps;
  const appPages = apps ? {
    botOf: (threadId: string) => (apps.store.groupByThread(threadId) ? null : apps.store.botByThread(threadId) ?? null),
    page: (threadId: string, messageId: string, rev?: number) => apps.chat.publishablePage(threadId, messageId, rev),
    post: (threadId: string, text: string, publishedPage: PublishedPageCard) => {
      try { return apps.store.appendMessage(threadId, { role: "bot", kind: "text", text, publishedPage }).id; } catch { return null; }
    },
  } : undefined;
  return { store, publisher, internal: createPagesInternalRoutes(publisher), routes: createPublishedPageRoutes(publisher, appPages), receive: applyIncludedPagesMessage };
}
