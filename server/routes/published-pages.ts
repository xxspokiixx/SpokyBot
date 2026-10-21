// The internal calls behind publish_page and unpublish_page, and the person's Unpublish on a page's chat card.
//
// The internal handler runs inside index.ts's /api/internal/ block, after the capability bearer is checked: the bot and
// its conversation come from the capability, never the body, and only the bot's own folders are read.
import type { ServerResponse } from "node:http";
import { z } from "zod";
import type { PublishedPageCard } from "../../shared/published-page.ts";
import { guestWorkspaceToHost } from "../bot-attachment.ts";
import { VM_WORKSPACE_GUEST } from "../container-computer.ts";
import type { json as sendJson } from "../harness/http.ts";
import type { PagePublisher } from "../pages/publisher.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PagesInternalContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  botId: string;
  threadId: string;
  /** index.ts's readInternalBody: re-checks the capability after the read. */
  readBody: () => Promise<unknown>;
  /** The bot's own folders for this turn, and its Local VM's workspace on this computer when it has one. */
  folders: () => Promise<{ roots: readonly string[]; vmWorkspace: string | null }>;
  /** Puts a card in the conversation the tool was called from; null when that conversation is gone. */
  post: (text: string, card: PublishedPageCard) => string | null;
}

const PUBLISH = "/api/internal/pages/publish", UNPUBLISH = "/api/internal/pages/unpublish";
const UNPUBLISH_ROUTE = /^\/api\/published-pages\/([a-z0-9]{20,63})\/unpublish$/;
const pageId = z.string().max(63).optional();
const publishBody = z.object({ path: z.string().max(4096), title: z.string().max(1000), page_id: pageId });
const unpublishBody = z.object({ page_id: pageId, path: z.string().max(4096).optional() });

/** A path inside the bot's Local VM workspace means the same file on this computer. */
const hostPath = (path: string, vmWorkspace: string | null) => vmWorkspace ? guestWorkspaceToHost(path, VM_WORKSPACE_GUEST, vmWorkspace) ?? path : path;

export function createPagesInternalRoutes(publisher: PagePublisher) {
  return async (ctx: PagesInternalContext): Promise<typeof PASS | void> => {
    if (ctx.method !== "POST" || (ctx.path !== PUBLISH && ctx.path !== UNPUBLISH)) return PASS;
    const raw = await ctx.readBody();
    const { roots, vmWorkspace } = await ctx.folders();
    const folders = vmWorkspace ? [vmWorkspace, ...roots] : roots;
    let outcome;
    if (ctx.path === PUBLISH) {
      const body = publishBody.safeParse(raw ?? {});
      if (!body.success) return void ctx.json(ctx.res, 400, { error: "publish_page takes path, title and optionally page_id, as text." });
      outcome = await publisher.publish({ botId: ctx.botId, threadId: ctx.threadId, path: hostPath(body.data.path, vmWorkspace), title: body.data.title,
        ...(body.data.page_id ? { pageId: body.data.page_id } : {}), roots: folders, post: ctx.post });
    } else {
      const body = unpublishBody.safeParse(raw ?? {});
      if (!body.success) return void ctx.json(ctx.res, 400, { error: "unpublish_page takes page_id, or the path the page was published from." });
      outcome = await publisher.unpublish({ ...(body.data.page_id ? { pageId: body.data.page_id } : {}),
        ...(body.data.path ? { path: hostPath(body.data.path, vmWorkspace) } : {}), botId: ctx.botId, roots: folders });
    }
    ctx.json(ctx.res, outcome.status, outcome.status === 200 ? { ok: true, text: outcome.text } : { error: outcome.text });
  };
}

/** POST /api/published-pages/<pageId>/unpublish: the card's Unpublish. An admin-scope route, so only the owner's own app. */
export function createPublishedPageRoutes(publisher: PagePublisher): RouteHandler {
  return async ({ res, path, method, json }) => {
    const match = UNPUBLISH_ROUTE.exec(path);
    if (!match || method !== "POST") return PASS;
    const outcome = await publisher.unpublish({ pageId: match[1] });
    json(res, outcome.status, outcome.status === 200 ? { ok: true, card: outcome.card } : { error: outcome.text });
  };
}
