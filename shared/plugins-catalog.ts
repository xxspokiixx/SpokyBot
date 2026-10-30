// Plugins & skills catalog domain model (spec: docs? Development prompt).
// Shared by server, UI, and assistant tool layer. Ids are stable strings.

export type PluginSource = "marketplace" | "user";
export type PluginCategory =
  | "Productivity"
  | "MCP"
  | "Data Analytics"
  | "Agent Orchestration"
  | string;
export type ConnectorTransport = "http" | "stdio";
export type ServerStatus = "connected" | "needsAuth" | "needsGrant" | "error" | "initializing";

export interface SetupField {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
}

export interface Account {
  label: string;
  status: ServerStatus;
}

export interface ConnectorTemplate {
  // display name in catalog; serverId assigned at install
  name: string;
  displayName?: string;
  transport: ConnectorTransport;
  // http
  url?: string;
  headers?: Record<string, string>;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: "oauth" | "token" | "none";
  clientId?: string;
  scopes?: string[];
}

export interface SkillSpec {
  name: string;
  description: string;
  body: string;
  files?: Record<string, string>;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  connectors: ConnectorTemplate[];
  skills: SkillSpec[];
  setupFields: SetupField[];
  source: PluginSource;
}

export interface InstalledPlugin {
  userId: string;
  pluginId: string;
  setupValues: Record<string, string>;
  serverIds: string[];
  installedAt: string;
}

export interface Connector {
  serverId: string;
  displayName: string;
  transport: ConnectorTransport;
  pluginId: string | null;
  accounts: Account[];
  customInstructions?: string;
  tools: string[];
  status: ServerStatus;
  detail?: string;
}

export interface SearchResult {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  connectorCount: number;
  skillCount: number;
  category: PluginCategory;
  addUrl?: string;
}

export function searchPlugins(plugins: Plugin[], query?: string, installedIds?: Set<string>): SearchResult[] {
  const q = (query ?? "").trim().toLowerCase();
  const scored = plugins.map((p) => {
    const haystack = `${p.name} ${p.description} ${p.category}`.toLowerCase();
    let score = 0;
    if (!q) score = 1;
    else if (haystack.includes(q)) score = 10 + (p.name.toLowerCase().includes(q) ? 5 : 0);
    else {
      // token overlap
      const tokens = q.split(/\s+/);
      for (const t of tokens) if (haystack.includes(t)) score += 2;
    }
    return { p, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, 10)
    .map(({ p }) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      installed: installedIds?.has(p.id) ?? false,
      connectorCount: p.connectors.length,
      skillCount: p.skills.length,
      category: p.category,
    }));
}
