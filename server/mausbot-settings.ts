import type { AppConfig } from "./config.ts";
import { chiefLevel } from "./chief-level.ts";
import type { BotRecord } from "./store.ts";

/** What a setting change needs from the server: the bot's own record and the workspace's saved config. */
export interface SettingsHost {
  bot(id: string): BotRecord | null;
  patchBot(id: string, patch: Partial<Pick<BotRecord, "sidebarHidden">>): unknown;
  config(): AppConfig;
  saveFeatures(patch: { showToolCalls: boolean }): void;
  team(): boolean;
}

interface Setting {
  name: string;
  title: (bot: BotRecord) => string;
  where: string;
  /** A change here is felt by everyone on the workspace, so on a team it is the person's to make in Settings, never a MausBot's (an Owner's or Admin's included). */
  workspaceWide: boolean;
  /** Setting this to `value` takes away a way the person has to reach something, so it waits for their yes. */
  reducesAccessWhen?: "off";
  /** What the person is told before they say yes. */
  warning?: (bot: BotRecord) => string;
  read(host: SettingsHost, bot: BotRecord): "on" | "off";
  write(host: SettingsHost, bot: BotRecord, value: "on" | "off"): void;
}

/** Security invariant: the only settings MausBot changes in chat. Each is a plain on/off switch the person sees in
 * Settings and can flip back; nothing here holds a credential, an approval level, billing, sharing or deletion. */
const SETTINGS: readonly Setting[] = [
  {
    name: "mausbot_in_sidebar",
    title: (bot) => `Show ${bot.name} in the sidebar`,
    where: "Settings → General",
    workspaceWide: false,
    reducesAccessWhen: "off",
    warning: (bot) => `This will hide ${bot.name} from the sidebar. You can bring it back with "Show ${bot.name} in the sidebar" in Settings → General.`,
    read: (_host, bot) => (bot.sidebarHidden ? "off" : "on"),
    write: (host, bot, value) => void host.patchBot(bot.id, { sidebarHidden: value === "off" }),
  },
  {
    name: "show_tool_calls",
    title: () => "Tool calls",
    where: "Settings → Appearance",
    workspaceWide: true,
    read: (host) => (host.config().features?.showToolCalls === true ? "on" : "off"),
    write: (host, _bot, value) => host.saveFeatures({ showToolCalls: value === "on" }),
  },
];

export const SETTING_NAMES: readonly string[] = SETTINGS.map((setting) => setting.name);

const CANNOT_CHANGE = "Everything else stays with the person in Settings: language, theme and other looks and notifications (they are kept on the device, not here), and anything about keys, sign-ins, approval levels, billing, sharing or deleting.";

/** The only bots the settings tools serve: a MausBot that holds a Chief's powers. */
export function holdsMausBotTools(bot: BotRecord | null | undefined): bot is BotRecord {
  return Boolean(bot?.defaultBot) && chiefLevel(bot);
}

const normal = (name: unknown): string => String(name ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

function onOff(value: unknown): "on" | "off" | null {
  const word = String(value ?? "").trim().toLowerCase();
  if (["on", "true", "yes", "show", "enable", "enabled"].includes(word)) return "on";
  if (["off", "false", "no", "hide", "disable", "disabled"].includes(word)) return "off";
  return null;
}

const unknownName = (given: unknown): string =>
  `"${String(given ?? "").slice(0, 60)}" is not a setting I can change. I can change: ${SETTING_NAMES.join(", ")}. ${CANNOT_CHANGE}`;

export type SettingsResult = { ok: true; text: string } | { ok: false; error: string };

export function listSettings(host: SettingsHost, bot: BotRecord): string {
  const settings = SETTINGS.map((setting) => ({
    name: setting.name,
    title: setting.title(bot),
    value: setting.read(host, bot),
    values: ["on", "off"],
    where: setting.where,
  }));
  return `${JSON.stringify({ settings })}\n${CANNOT_CHANGE}`;
}

const yes = (confirm: unknown): boolean => confirm === true || String(confirm).trim().toLowerCase() === "true";

export function changeSetting(host: SettingsHost, botId: string, name: unknown, value: unknown, confirm?: unknown): SettingsResult {
  const bot = host.bot(botId);
  if (!holdsMausBotTools(bot)) return { ok: false, error: "Only MausBot changes settings in chat." };
  const setting = SETTINGS.find((candidate) => candidate.name === normal(name));
  if (!setting) return { ok: false, error: unknownName(name) };
  const next = onOff(value);
  if (!next) return { ok: false, error: `"${String(value ?? "").slice(0, 40)}" is not a value for ${setting.name}. Use "on" or "off".` };
  if (setting.workspaceWide && (bot.defaultBot?.person || host.team())) {
    return { ok: false, error: `${setting.title(bot)} applies to everyone on this team, so it is changed by the person in ${setting.where}, not from chat.` };
  }
  const title = setting.title(bot);
  const before = setting.read(host, bot);
  if (before === next) return { ok: true, text: `${title} is already ${next}. Nothing changed.` };
  if (setting.reducesAccessWhen === next && !yes(confirm)) {
    return { ok: true, text: `Nothing changed yet. ${setting.warning?.(bot) ?? "This takes away a way you have to reach something."} Ask the person; if they say yes, call set_app_setting again with the same setting and value and confirm: true.` };
  }
  try {
    setting.write(host, bot, next);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "the write failed";
    return { ok: false, error: `${title} could not be saved (${reason}). Nothing was changed; tell the person to change it in ${setting.where}.` };
  }
  const after = setting.read(host, bot);
  if (after !== next) return { ok: false, error: `${title} could not be changed. Nothing was saved; tell the person to change it in ${setting.where}.` };
  return {
    ok: true,
    text: `Changed "${title}" (${setting.where}) from ${before} to ${after}. To undo, ask me to set ${setting.name} back to ${before}, or switch it in ${setting.where}.`,
  };
}
