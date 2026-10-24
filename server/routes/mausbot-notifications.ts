// The internal calls behind MausBot's list_unread_notifications and mark_notifications_read tools. Runs inside index.ts's
// /api/internal/ block after the capability bearer is checked; the bot is the capability's. The only write is "read".
import type { ServerResponse } from "node:http";

import type { json as sendJson } from "../harness/http.ts";
import { listUnread, markRead, type NotificationsHost } from "../mausbot-notifications.ts";
import { PASS } from "./table.ts";

export interface MausBotNotificationsContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  botId: string;
  readBody: () => Promise<unknown>;
}

const LIST = "/api/internal/notifications";
const READ = "/api/internal/notifications/read";

export function createMausBotNotificationRoutes(host: NotificationsHost) {
  return async (ctx: MausBotNotificationsContext): Promise<typeof PASS | void> => {
    if (!((ctx.method === "GET" && ctx.path === LIST) || (ctx.method === "POST" && ctx.path === READ))) return PASS;
    let result;
    if (ctx.path === LIST) result = listUnread(host, ctx.botId);
    else {
      const body = await ctx.readBody();
      result = markRead(host, ctx.botId, body && typeof body === "object" ? (body as Record<string, unknown>).ids : undefined);
    }
    if (result.ok) return void ctx.json(ctx.res, 200, { text: result.text });
    return void ctx.json(ctx.res, result.error.startsWith("Only MausBot") ? 403 : 400, { error: result.error });
  };
}
