import { afterEach, describe, expect, it, vi } from "vitest";

import { chiefLevel, readTeamRolesWith } from "./chief-level.ts";
import type { AppConfig } from "./config.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { MAUSBOT_TOOL_DEFINITIONS, MAUSBOT_TOOL_NAMES } from "./drivers/agents-mausbot-tools.ts";
import { changeSetting, listSettings, holdsMausBotTools, SETTING_NAMES, type SettingsHost } from "./mausbot-settings.ts";
import { createMausBotSettingsRoutes } from "./routes/mausbot-settings.ts";
import { PASS } from "./routes/table.ts";
import type { BotRecord } from "./store.ts";

const bot = (fields: Partial<BotRecord>): BotRecord => ({ id: "b1", name: "MausBot", ...fields }) as BotRecord;
const MAUS = bot({ id: "maus", defaultBot: {} });

function host(bots: BotRecord[], config: AppConfig = {} as AppConfig, team = false) {
  const records = new Map(bots.map((record) => [record.id, { ...record }]));
  const saveFeatures = vi.fn((patch: { showToolCalls: boolean }) => { config = { ...config, features: { ...config.features, ...patch } }; });
  const api: SettingsHost = {
    bot: (id) => records.get(id) ?? null,
    patchBot: (id, patch) => { Object.assign(records.get(id)!, patch); },
    config: () => config,
    saveFeatures,
    team: () => team,
  };
  return { api, records, saveFeatures };
}

afterEach(() => readTeamRolesWith(() => null));

describe("who may change settings", () => {
  it("is a MausBot with a Chief's powers, never another bot, the Chief, or a Team User's MausBot", () => {
    expect(holdsMausBotTools(MAUS)).toBe(true);
    expect(holdsMausBotTools(bot({ chiefOfStaff: true }))).toBe(false);
    expect(holdsMausBotTools(bot({}))).toBe(false);
    expect(holdsMausBotTools(null)).toBe(false);
    const member = bot({ defaultBot: { person: "user@example.com" } });
    const admin = bot({ defaultBot: { person: "admin@example.com" } });
    expect([holdsMausBotTools(member), holdsMausBotTools(admin)]).toEqual([false, false]);
    readTeamRolesWith((email) => email === "admin@example.com" ? "admin" : "member");
    expect([holdsMausBotTools(member), holdsMausBotTools(admin)]).toEqual([false, true]);
    expect(chiefLevel(member)).toBe(false);
  });

  it("mounts the tools only for the MausBot flag", () => {
    const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "b", ...env })).map((tool) => tool.name);
    expect(names({ OMB_CHIEF_OF_STAFF: "1", OMB_MAUSBOT: "0" })).not.toEqual(expect.arrayContaining(["list_app_settings"]));
    expect(names({ OMB_CHIEF_OF_STAFF: "1" })).not.toContain("set_app_setting");
    expect(names({ OMB_CHIEF_OF_STAFF: "1", OMB_MAUSBOT: "1" })).toEqual(expect.arrayContaining(["list_app_settings", "set_app_setting"]));
    const base = names({ OMB_CHIEF_OF_STAFF: "1" });
    expect(names({ OMB_CHIEF_OF_STAFF: "1", OMB_MAUSBOT: "1" })).toEqual([...base, ...MAUSBOT_TOOL_NAMES]);
  });

  it("advertises a flat schema", () => {
    const wire = JSON.stringify(MAUSBOT_TOOL_DEFINITIONS);
    expect(wire).not.toMatch(/"(oneOf|anyOf|allOf|const|format)"/);
    expect(MAUSBOT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([...MAUSBOT_TOOL_NAMES]);
  });
});

describe("the allowlist", () => {
  it("names two plain switches and nothing near credentials, approvals, billing, sharing or deletion", () => {
    expect(SETTING_NAMES).toEqual(["mausbot_in_sidebar", "show_tool_calls"]);
    expect(SETTING_NAMES.join(" ")).not.toMatch(/key|token|secret|login|password|approval|access|billing|plan|share|lend|delete/);
  });

  it("lists each setting with its value and where it is in Settings", () => {
    const { api } = host([{ ...MAUS, sidebarHidden: true }], { features: { showToolCalls: true } } as AppConfig);
    const text = listSettings(api, api.bot("maus")!);
    expect(JSON.parse(text.split("\n")[0]!)).toEqual({ settings: [
      { name: "mausbot_in_sidebar", title: "Show MausBot in the sidebar", value: "off", values: ["on", "off"], where: "Settings → General" },
      { name: "show_tool_calls", title: "Tool calls", value: "on", values: ["on", "off"], where: "Settings → Appearance" },
    ] });
    expect(text).toContain("Everything else stays with the person in Settings");
  });
});

describe("changing a setting", () => {
  it("hides MausBot from the sidebar and says what changed and how to undo it", () => {
    const { api, records } = host([MAUS]);
    const result = changeSetting(api, "maus", "mausbot_in_sidebar", "off");
    expect(result).toEqual({ ok: true, text: 'Changed "Show MausBot in the sidebar" (Settings → General) from on to off. To undo, ask me to set mausbot_in_sidebar back to on, or switch it in Settings → General.' });
    expect(records.get("maus")?.sidebarHidden).toBe(true);
    expect(changeSetting(api, "maus", "mausbot_in_sidebar", "on")).toMatchObject({ ok: true });
    expect(records.get("maus")?.sidebarHidden).toBe(false);
  });

  it("saves the tool-calls switch once and reports an unchanged value without saving", () => {
    const { api, saveFeatures } = host([MAUS]);
    expect(changeSetting(api, "maus", "show_tool_calls", "on")).toMatchObject({ ok: true, text: expect.stringContaining("from off to on") });
    expect(saveFeatures).toHaveBeenCalledExactlyOnceWith({ showToolCalls: true });
    expect(changeSetting(api, "maus", "show_tool_calls", "on")).toEqual({ ok: true, text: "Tool calls is already on. Nothing changed." });
    expect(saveFeatures).toHaveBeenCalledTimes(1);
  });

  it("reads a model's loose wording: case, spaces, hyphens, true and false", () => {
    const { api } = host([MAUS]);
    expect(changeSetting(api, "maus", " Show-Tool Calls ", "TRUE")).toMatchObject({ ok: true, text: expect.stringContaining("from off to on") });
    expect(changeSetting(api, "maus", "show_tool_calls", false)).toMatchObject({ ok: true, text: expect.stringContaining("from on to off") });
  });

  it.each(["api_key", "approval_mode", "language", "theme", "delete_bot", "", undefined, "__proto__", "constructor"])("refuses %j and names the valid settings", (name) => {
    const { api, saveFeatures, records } = host([MAUS]);
    const result = changeSetting(api, "maus", name, "on");
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("I can change: mausbot_in_sidebar, show_tool_calls.") });
    expect(saveFeatures).not.toHaveBeenCalled();
    expect(records.get("maus")).toEqual(MAUS);
  });

  it("refuses a value that is not on or off, and changes nothing", () => {
    const { api, saveFeatures } = host([MAUS]);
    expect(changeSetting(api, "maus", "show_tool_calls", "maybe")).toEqual({ ok: false, error: '"maybe" is not a value for show_tool_calls. Use "on" or "off".' });
    expect(saveFeatures).not.toHaveBeenCalled();
  });

  it("refuses any other bot, and a Team MausBot's change to what the whole team shares", () => {
    readTeamRolesWith(() => "admin");
    const { api, saveFeatures, records } = host([bot({ id: "pip" }), bot({ id: "chief", chiefOfStaff: true }), bot({ id: "ada", defaultBot: { person: "ada@example.com" } })]);
    for (const id of ["pip", "chief", "missing"]) expect(changeSetting(api, id, "show_tool_calls", "on")).toEqual({ ok: false, error: "Only MausBot changes settings in chat." });
    expect(changeSetting(api, "ada", "show_tool_calls", "on")).toMatchObject({ ok: false, error: expect.stringContaining("applies to everyone on this team") });
    expect(saveFeatures).not.toHaveBeenCalled();
    expect(changeSetting(api, "ada", "mausbot_in_sidebar", "off")).toMatchObject({ ok: true });
    expect(records.get("ada")?.sidebarHidden).toBe(true);
    expect(records.get("pip")?.sidebarHidden).toBeUndefined();
  });

  it("tells a team's Owner or Admin MausBot that workspace-wide settings are the person's to change", () => {
    readTeamRolesWith(() => "owner");
    const { api, saveFeatures } = host([bot({ id: "ada", defaultBot: { person: "ada@example.com" } })]);
    expect(changeSetting(api, "ada", "show_tool_calls", "on")).toEqual({ ok: false, error: "Tool calls applies to everyone on this team, so it is changed by the person in Settings → Appearance, not from chat." });
    expect(saveFeatures).not.toHaveBeenCalled();
  });

  it("refuses a workspace-wide setting whenever the server is a team, even for a person-less MausBot", () => {
    const { api, saveFeatures } = host([MAUS], {} as AppConfig, true);
    expect(changeSetting(api, "maus", "show_tool_calls", "on")).toMatchObject({ ok: false, error: expect.stringContaining("applies to everyone on this team") });
    expect(saveFeatures).not.toHaveBeenCalled();
    expect(changeSetting(api, "maus", "mausbot_in_sidebar", "off")).toMatchObject({ ok: true });
  });

  it("turns a failed save into the plain change-it-in-Settings text", () => {
    const { api } = host([MAUS]);
    api.saveFeatures = () => { throw new Error("EACCES: config.json is read-only"); };
    expect(changeSetting(api, "maus", "show_tool_calls", "on")).toEqual({ ok: false, error: "Tool calls could not be saved (EACCES: config.json is read-only). Nothing was changed; tell the person to change it in Settings → Appearance." });
    api.patchBot = () => { throw "disk full"; };
    expect(changeSetting(api, "maus", "mausbot_in_sidebar", "off")).toMatchObject({ ok: false, error: expect.stringContaining("the write failed") });
  });

  it("does not report a change that did not stick", () => {
    const { api } = host([MAUS]);
    api.saveFeatures = () => {};
    expect(changeSetting(api, "maus", "show_tool_calls", "on")).toMatchObject({ ok: false, error: expect.stringContaining("Nothing was saved") });
  });
});

describe("the internal route", () => {
  async function call(botId: string, method: string, path: string, body?: unknown) {
    const { api } = host([MAUS, bot({ id: "pip" })]);
    const json = vi.fn();
    const outcome = await createMausBotSettingsRoutes(api)({ method, path, res: {} as never, json, botId, readBody: async () => body });
    const [, status, payload] = json.mock.calls[0] ?? [];
    return { outcome, status: status as number | undefined, payload: payload as { text?: string; error?: string } | undefined };
  }

  it("lists and sets for MausBot, from the capability's bot", async () => {
    expect((await call("maus", "GET", "/api/internal/settings")).status).toBe(200);
    const set = await call("maus", "POST", "/api/internal/settings/set", { setting: "show_tool_calls", value: "on" });
    expect([set.status, set.payload?.text]).toEqual([200, expect.stringContaining("from off to on")]);
    const refused = await call("maus", "POST", "/api/internal/settings/set", { setting: "anthropic_key", value: "on" });
    expect([refused.status, refused.payload?.error]).toEqual([400, expect.stringContaining("I can change:")]);
    expect((await call("maus", "POST", "/api/internal/settings/set", "nonsense")).status).toBe(400);
  });

  it("answers 403 to every other bot on both paths, and passes other paths on", async () => {
    expect((await call("pip", "GET", "/api/internal/settings")).status).toBe(403);
    expect((await call("pip", "POST", "/api/internal/settings/set", { setting: "show_tool_calls", value: "on" })).status).toBe(403);
    expect((await call("maus", "GET", "/api/internal/other")).outcome).toBe(PASS);
    expect((await call("maus", "POST", "/api/internal/settings")).outcome).toBe(PASS);
  });
});
