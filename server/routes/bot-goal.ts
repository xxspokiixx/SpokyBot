import type { RequestAuth } from "../request-auth.ts";
import { BotGoalRefused, type BotGoals } from "../bot-goal.ts";
import type { Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotGoalRouteDeps {
  store: Pick<Store, "bot" | "taskByThread">;
  goals: Pick<BotGoals, "set" | "pause" | "resume" | "clear">;
  cloudGuestSendRefusal(auth: RequestAuth, threadId: string): string | null;
  directSendRefusal(botId: string, threadId: string): { status: number; body: Record<string, unknown> } | null;
}

const ACTIONS = new Set(["set", "pause", "resume", "clear"]);

/** POST /api/bots/:id/goal { threadId, action: "set" | "pause" | "resume" | "clear", text? }: the standing goal of one conversation. */
export function createBotGoalRoutes(deps: BotGoalRouteDeps): RouteHandler {
  const { store, goals } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = path.match(/^\/api\/bots\/([\w-]+)\/goal$/);
    if (!m || method !== "POST") return PASS;
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
    const { threadId, action, text } = body as { threadId?: unknown; action?: unknown; text?: unknown };
    if (typeof threadId !== "string" || !/^[\w-]+$/.test(threadId)) return json(res, 400, { error: "threadId must be a task id" });
    if (typeof action !== "string" || !ACTIONS.has(action)) return json(res, 400, { error: "action must be set, pause, resume or clear" });
    const bot = store.bot(m[1]!);
    if (!bot || !store.taskByThread(bot.id, threadId)) return json(res, 404, { error: "no such conversation" });
    const notYours = deps.cloudGuestSendRefusal(auth, threadId);
    if (notYours) return json(res, 403, { error: notYours });
    if (action === "set" || action === "resume") {
      const refused = deps.directSendRefusal(bot.id, threadId);
      if (refused) return json(res, refused.status, refused.body);
    }
    try {
      if (action === "set") {
        if (typeof text !== "string") return json(res, 400, { error: "text required" });
        return json(res, 200, { goal: goals.set(bot.id, threadId, text) });
      }
      if (action === "clear") goals.clear(threadId);
      const goal = action === "pause" ? goals.pause(threadId) : action === "resume" ? goals.resume(threadId) : null;
      return json(res, 200, { goal });
    } catch (error) {
      if (error instanceof BotGoalRefused) return json(res, error.status, { error: error.message });
      throw error;
    }
  };
}
