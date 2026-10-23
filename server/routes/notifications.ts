import { markAllNotificationLogRead, markNotificationLogRead, markThreadNotificationLogRead, recentNotificationLog } from "../message-db.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Opening a conversation reads its notifications, so every open app's badge drops them too. */
export function readThreadNotifications(threadId: string, broadcast: (payload: Record<string, unknown>) => void): void {
  const ids = markThreadNotificationLogRead(threadId);
  if (ids.length) broadcast({ kind: "notifications.read", threadId, ids });
}

export function createNotificationRoutes(deps = {
  recent: recentNotificationLog,
  markRead: markNotificationLogRead,
  markAllRead: markAllNotificationLogRead,
}): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (method === "GET" && path === "/api/notifications") {
      return json(res, 200, { notifications: deps.recent() });
    }
    if (method !== "POST") return PASS;
    if (path === "/api/notifications/read-all") {
      deps.markAllRead();
      return json(res, 200, { ok: true });
    }
    const m = path.match(/^\/api\/notifications\/([\w-]+)\/read$/);
    if (!m) return PASS;
    deps.markRead(m[1]!);
    return json(res, 200, { ok: true });
  };
}
