import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Plugin, InstalledPlugin, Connector, SearchResult } from "../shared/plugins-catalog.ts";
import { searchPlugins } from "../shared/plugins-catalog.ts";

const DATA_DIR = process.env.OPENMAUSBOT_DATA_DIR || join(homedir(), ".openmausbot");
const STORE_FILE = join(DATA_DIR, "plugins-catalog.json");

interface Store {
  plugins: Plugin[];
  installed: [string, InstalledPlugin][];
  servers: [string, Connector][];
}

const plugins = new Map<string, Plugin>();
const installed = new Map<string, InstalledPlugin>();
const servers = new Map<string, Connector>();

function load() {
  try {
    const raw = readFileSync(STORE_FILE, "utf8");
    const data = JSON.parse(raw) as Store;
    for (const p of data.plugins ?? []) plugins.set(p.id, p);
    for (const [k, v] of data.installed ?? []) installed.set(k, v);
    for (const [k, v] of data.servers ?? []) servers.set(k, v);
  } catch {
    // no store yet
  }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const data: Store = {
      plugins: [...plugins.values()],
      installed: [...installed.entries()],
      servers: [...servers.entries()],
    };
    writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // ignore persistence errors
  }
}

load();

// Seed default catalog entries so the UI is not empty on first run.
if (plugins.size === 0) {
  registerPlugin({
    id: "cursor-mcp",
    name: "Cursor",
    description: "Cursor MCP server and plugins.",
    category: "MCP",
    connectors: [{ name: "cursor", displayName: "Cursor", transport: "http", url: "https://mcp.cursor.com/mcp", auth: "oauth" }],
    skills: [],
    setupFields: [],
    source: "marketplace",
  });
  registerPlugin({
    id: "skillmd-io",
    name: "SkillMD (io)",
    description: "Skills from skillmd.io",
    category: "Agent Orchestration",
    connectors: [],
    skills: [{ name: "skillmd-io-pack", description: "Use when you need skills from skillmd.io", body: "Skills sourced from https://skillmd.io" }],
    setupFields: [],
    source: "marketplace",
  });
  registerPlugin({
    id: "skillmd-com",
    name: "SkillMD (com)",
    description: "Skills from skillmd.com",
    category: "Agent Orchestration",
    connectors: [],
    skills: [{ name: "skillmd-com-pack", description: "Use when you need skills from skillmd.com", body: "Skills sourced from https://skillmd.com" }],
    setupFields: [],
    source: "marketplace",
  });
}

export function registerPlugin(p: Plugin): void {
  plugins.set(p.id, p);
  save();
}

export function listPlugins(): Plugin[] {
  return [...plugins.values()];
}

export function getPlugin(id: string): Plugin | undefined {
  return plugins.get(id);
}

export function isInstalled(userId: string, pluginId: string): boolean {
  return installed.has(`${userId}::${pluginId}`);
}

export function installedIds(userId: string): Set<string> {
  const out = new Set<string>();
  for (const [key] of installed) {
    const [u, pid] = key.split("::");
    if (u === userId) out.add(pid);
  }
  return out;
}

export function searchCatalog(userId: string, query?: string): SearchResult[] {
  return searchPlugins(listPlugins(), query, installedIds(userId)).map((r: SearchResult) => ({
    ...r,
    addUrl: r.installed ? undefined : `https://app.local/link/v1/plugin/add?id=${r.id}`,
  }));
}

export interface InstallResult {
  ok: boolean;
  error?: string;
  serverIds?: string[];
}

export function installPlugin(userId: string, pluginId: string, values: Record<string, string> = {}): InstallResult {
  const p = plugins.get(pluginId);
  if (!p) return { ok: false, error: "plugin not found" };
  for (const f of p.setupFields) {
    if (f.required && !values[f.key]) return { ok: false, error: `missing required field ${f.key}` };
  }
  if (isInstalled(userId, pluginId)) {
    return { ok: true, serverIds: installed.get(`${userId}::${pluginId}`)!.serverIds };
  }
  const serverIds: string[] = [];
  for (const c of p.connectors) {
    const sid = `user-${c.name || p.id}`;
    if (!servers.has(sid)) {
      servers.set(sid, {
        serverId: sid,
        displayName: c.displayName || c.name,
        transport: c.transport,
        pluginId: p.id,
        accounts: [{ label: "default", status: c.auth === "none" ? "connected" : "needsAuth" }],
        tools: [],
        status: c.auth === "none" ? "connected" : "needsAuth",
      });
    }
    serverIds.push(sid);
  }
  installed.set(`${userId}::${pluginId}`, {
    userId,
    pluginId,
    setupValues: values,
    serverIds,
    installedAt: new Date().toISOString(),
  });
  save();
  return { ok: true, serverIds };
}

export function uninstallPlugin(userId: string, pluginId: string): { ok: boolean; error?: string } {
  const key = `${userId}::${pluginId}`;
  const ip = installed.get(key);
  if (!ip) return { ok: false, error: "not installed" };
  for (const sid of ip.serverIds) servers.delete(sid);
  installed.delete(key);
  save();
  return { ok: true };
}

export function getMcpServerStatus(serverId?: string): Connector[] {
  const all = [...servers.values()];
  return serverId ? all.filter((s) => s.serverId === serverId) : all;
}

export function authenticateMcpServer(serverId: string, accountLabel: string, forceReauth = false): { ok: boolean; error?: string } {
  const s = servers.get(serverId);
  if (!s) return { ok: false, error: "server not found" };
  let target = s.accounts.find((a) => a.label === accountLabel);
  if (!target) {
    s.accounts.push({ label: accountLabel, status: "needsAuth" });
    target = s.accounts[s.accounts.length - 1];
  }
  if (forceReauth) target.status = "needsAuth";
  target.status = "connected";
  s.status = "connected";
  save();
  return { ok: true };
}

export function addMcpServer(input: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string>; headers?: Record<string, string> }): { ok: boolean; error?: string; serverId?: string } {
  const sid = `user-${input.name}`;
  if (servers.has(sid)) return { ok: false, error: "already exists" };
  const transport: "http" | "stdio" = input.url ? "http" : "stdio";
  servers.set(sid, {
    serverId: sid,
    displayName: input.name,
    transport,
    pluginId: null,
    accounts: [{ label: "default", status: "needsAuth" }],
    tools: [],
    status: "needsAuth",
  });
  save();
  return { ok: true, serverId: sid };
}

export function removeMcpAccount(serverId: string, account: string): { ok: boolean; error?: string } {
  const s = servers.get(serverId);
  if (!s) return { ok: false, error: "server not found" };
  const idx = s.accounts.findIndex((a) => a.label === account);
  if (idx === -1) return { ok: false, error: "account not found" };
  s.accounts.splice(idx, 1);
  save();
  return { ok: true };
}

export function renameMcpAccount(serverId: string, account: string, newLabel: string): { ok: boolean; error?: string } {
  const s = servers.get(serverId);
  if (!s) return { ok: false, error: "server not found" };
  const acc = s.accounts.find((a) => a.label === account);
  if (!acc) return { ok: false, error: "account not found" };
  acc.label = newLabel;
  save();
  return { ok: true };
}

export function setMcpInstructions(serverId: string, text: string | null): { ok: boolean; error?: string } {
  const s = servers.get(serverId);
  if (!s) return { ok: false, error: "server not found" };
  s.customInstructions = text ?? undefined;
  save();
  return { ok: true };
}

export function restartMcpServers(): { ok: boolean } {
  for (const s of servers.values()) {
    if (s.status === "error") s.status = "initializing";
  }
  save();
  return { ok: true };
}

export function uninstallMcpServer(serverId: string): { ok: boolean; error?: string } {
  const s = servers.get(serverId);
  if (!s) return { ok: false, error: "server not found" };
  if (s.pluginId) return { ok: false, error: "plugin-backed servers cannot be removed directly" };
  servers.delete(serverId);
  save();
  return { ok: true };
}
