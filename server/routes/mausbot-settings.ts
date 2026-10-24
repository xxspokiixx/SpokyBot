// The internal calls behind MausBot's list_app_settings and set_app_setting tools. Runs inside index.ts's /api/internal/
// block, after the capability bearer is checked; the bot is the capability's, never a body field. Agents tools do not ask
// for approval, so this route is the whole gate: the allowlist and who may use it live in server/mausbot-settings.ts.
import type { ServerResponse } from "node:http";

import type { json as sendJson } from "../harness/http.ts";
import { changeSetting, listSettings, holdsMausBotTools, type SettingsHost } from "../mausbot-settings.ts";
import { PASS } from "./table.ts";

export interface MausBotSettingsContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  botId: string;
  readBody: () => Promise<unknown>;
}

const LIST = "/api/internal/settings";
const SET = "/api/internal/settings/set";

export function createMausBotSettingsRoutes(host: SettingsHost) {
  return async (ctx: MausBotSettingsContext): Promise<typeof PASS | void> => {
    if (!((ctx.method === "GET" && ctx.path === LIST) || (ctx.method === "POST" && ctx.path === SET))) return PASS;
    const bot = host.bot(ctx.botId);
    if (!holdsMausBotTools(bot)) return void ctx.json(ctx.res, 403, { error: "Only MausBot changes settings in chat." });
    if (ctx.path === LIST) return void ctx.json(ctx.res, 200, { text: listSettings(host, bot) });
    const body = await ctx.readBody();
    const args = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const result = changeSetting(host, ctx.botId, args.setting, args.value);
    return void ctx.json(ctx.res, result.ok ? 200 : 400, result.ok ? { text: result.text } : { error: result.error });
  };
}
