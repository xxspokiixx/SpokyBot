// Which of the person's MCP servers have apps (docs/superpowers/specs/
// 2026-10-14-chat-apps-design.md, "App catalog"), persisted to
// DATA_DIR/mcp-app-catalog.json.
//
// One entry per server name, kept for the configuration it was learned from
// (`hash`: the command, its arguments and environment, or the URL; never a
// sign-in token): an edited server is a server never seen. An entry says
// whether the server has apps (a tool with a `ui://` UI), whether it took
// OMB's UI extension, and the app-relevant tools (those with a UI or a
// visibility), which is what Settings and the approval rules read.
//
// Filled by the Settings → Test probe and the background probe
// (server/chat-apps-mcp.ts), the app connections' tools/list
// (mcp-app-connections.ts) and every reported app call. Mount code consults
// `apps` (Decision 7): a server never probed or observed is mounted as today.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { McpServerSpec } from "./contracts.ts";
import { toolUiResource, toolVisibility, uiMeta, type AppVisibility } from "./mcp-app-observer.ts";

/** An entry older than this is probed again in the background. */
export const MCP_APP_CATALOG_STALE_MS = 7 * 24 * 60 * 60_000;
const MAX_TOOLS = 500;

export type UiExtensionState = "ok" | "refused" | "unknown";

export interface McpAppCatalogTool {
  title?: string;
  visibility: AppVisibility[];
  resourceUri?: string;
  readOnly: boolean;
  destructive: boolean;
}

export interface McpAppCatalogEntry {
  apps: boolean;
  uiExtension: UiExtensionState;
  tools: Record<string, McpAppCatalogTool>;
  at: number;
}

interface StoredEntry extends McpAppCatalogEntry {
  hash: string;
}

type Json = Record<string, unknown>;
function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** What a server is, for the catalog: a URL server's type and address, a
 * command server's command, arguments and environment. Headers are left
 * out, so a refreshed sign-in token is the same server. Hashed: no
 * credential is stored. */
export function mcpServerConfigHash(server: McpServerSpec | Json): string {
  const record = server as Json;
  const identity = typeof record.url === "string"
    ? { type: record.type === "sse" ? "sse" : "http", url: record.url }
    : { command: record.command, args: Array.isArray(record.args) ? record.args : [], env: isRecord(record.env) ? record.env : {} };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

/** The catalog's view of one tool definition, or null when it is not an app
 * tool (no UI and no visibility). */
export function catalogTool(tool: unknown): McpAppCatalogTool | null {
  if (!isRecord(tool) || typeof tool.name !== "string") return null;
  const resourceUri = toolUiResource(tool);
  const ui = uiMeta(tool);
  if (!resourceUri && !Array.isArray(ui?.visibility)) return null;
  const annotations = isRecord(tool.annotations) ? tool.annotations : {};
  const title = typeof tool.title === "string" ? tool.title : typeof annotations.title === "string" ? annotations.title : undefined;
  return {
    ...(title ? { title: title.slice(0, 200) } : {}),
    visibility: toolVisibility(tool),
    ...(resourceUri ? { resourceUri } : {}),
    readOnly: annotations.readOnlyHint === true,
    destructive: annotations.destructiveHint === true,
  };
}

function isEntry(value: unknown): value is StoredEntry {
  return isRecord(value) && typeof value.hash === "string" && typeof value.apps === "boolean"
    && (value.uiExtension === "ok" || value.uiExtension === "refused" || value.uiExtension === "unknown")
    && isRecord(value.tools) && typeof value.at === "number";
}

export class McpAppCatalog {
  private readonly file: string | null;
  private readonly now: () => number;
  private entries: Map<string, StoredEntry> | null = null;

  /** `file` null: kept in memory only (tests). */
  constructor(file: string | null, options: { now?: () => number } = {}) {
    this.file = file;
    this.now = options.now ?? Date.now;
  }

  private load(): Map<string, StoredEntry> {
    if (this.entries) return this.entries;
    this.entries = new Map();
    if (!this.file) return this.entries;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      const servers = isRecord(parsed) && parsed.v === 1 && isRecord(parsed.servers) ? parsed.servers : {};
      for (const [name, entry] of Object.entries(servers)) if (isEntry(entry)) this.entries.set(name, entry);
    } catch { /* none yet, or unreadable: learned again */ }
    return this.entries;
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
      writeFileSync(temp, JSON.stringify({ v: 1, servers: Object.fromEntries(this.load()) }, null, 2), { mode: 0o600 });
      renameSync(temp, this.file);
    } catch (error) {
      console.error("mcp apps: could not save the app catalog", error);
    }
  }

  /** The entry for this server as configured now, or undefined. */
  get(name: string, server: McpServerSpec | Json): McpAppCatalogEntry | undefined {
    const entry = this.load().get(name);
    if (!entry || entry.hash !== mcpServerConfigHash(server)) return undefined;
    const { hash: _hash, ...rest } = entry;
    return rest;
  }

  /** No entry, or one older than MCP_APP_CATALOG_STALE_MS. */
  stale(name: string, server: McpServerSpec | Json): boolean {
    const entry = this.get(name, server);
    return !entry || this.now() - entry.at > MCP_APP_CATALOG_STALE_MS;
  }

  private put(name: string, server: McpServerSpec | Json, update: (previous: McpAppCatalogEntry | undefined) => McpAppCatalogEntry): McpAppCatalogEntry {
    const next = update(this.get(name, server));
    const entries = this.load();
    const before = entries.get(name);
    const stored: StoredEntry = { ...next, hash: mcpServerConfigHash(server) };
    entries.set(name, stored);
    // A record that changes nothing but its time is saved at most hourly.
    const { at: _a, ...was } = before ?? { at: 0 };
    const { at: _b, ...now } = stored;
    if (!before || JSON.stringify(was) !== JSON.stringify(now) || stored.at - before.at > 60 * 60_000) this.save();
    return next;
  }

  /** A whole tools/list (a probe, an app connection): the server's tools and
   * whether it took the extension. `uiExtension` undefined keeps what was known. */
  recordList(name: string, server: McpServerSpec | Json, tools: unknown[], uiExtension?: UiExtensionState): McpAppCatalogEntry {
    const known: Record<string, McpAppCatalogTool> = {};
    for (const tool of tools) {
      const entry = catalogTool(tool);
      if (entry && Object.keys(known).length < MAX_TOOLS) known[(tool as { name: string }).name] = entry;
    }
    return this.put(name, server, (previous) => ({
      apps: Object.values(known).some((tool) => tool.resourceUri !== undefined),
      uiExtension: uiExtension ?? previous?.uiExtension ?? "unknown",
      tools: known,
      at: this.now(),
    }));
  }

  /** One observed app call: this server has apps, and this is its tool. */
  recordTool(name: string, server: McpServerSpec | Json, definition: unknown): McpAppCatalogEntry | undefined {
    const tool = catalogTool(definition);
    if (!tool || !tool.resourceUri) return undefined;
    return this.put(name, server, (previous) => ({
      apps: true,
      uiExtension: previous?.uiExtension ?? "unknown",
      tools: { ...previous?.tools, [(definition as { name: string }).name]: tool },
      at: previous?.at ?? this.now(),
    }));
  }

  /** Forget a server (removed from Settings). */
  forget(name: string): void {
    if (this.load().delete(name)) this.save();
  }
}
