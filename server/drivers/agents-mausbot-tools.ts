// MausBot's two settings tools: read the allowlist, change one. The catalog shows them only to a MausBot; the internal
// route (server/routes/mausbot-settings.ts) refuses every other bot regardless.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const MAUSBOT_TOOL_NAMES: ReadonlySet<string> = new Set(["list_app_settings", "set_app_setting"]);

export async function callMausBotTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = name === "list_app_settings"
    ? await context.client.apiResponse("/api/internal/settings")
    : await context.client.apiResponse("/api/internal/settings/set", { method: "POST", body: JSON.stringify({ setting: args.setting, value: args.value }) });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "That setting could not be changed."), isError: true };
}

export const MAUSBOT_TOOL_DEFINITIONS = [
  {
    name: "list_app_settings",
    description: "MausBot only. The in-app settings you may change when the person asks, each with its current value and where it is in Settings. Call it before set_app_setting. Anything not listed is not yours to change; point the person to Settings instead.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "set_app_setting",
    description: "MausBot only. Switch one setting from list_app_settings on or off because the person asked for it in this chat, never on your own. The result says what changed, from what to what, and how to undo it: tell the person exactly that. An unknown setting is refused with the valid names.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        setting: { type: "string", maxLength: 60, description: "A name from list_app_settings, such as show_tool_calls." },
        value: { type: "string", enum: ["on", "off"], description: "on or off." },
      },
      required: ["setting", "value"],
    },
  },
];
