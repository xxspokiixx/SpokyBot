// Plugin catalog rules shared by the Apps UI and the server. No JSON import: the server build cannot load JSON modules.

export const PLUGIN_CATEGORIES = ["productivity", "integrations", "developer-tools", "utilities", "finance"] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];
export type PluginKind = "connector" | "skills" | "both";
export type PluginTransport = "http" | "sse";
export type PluginAuth = "oauth" | "token" | "none";

/** The MCP registry accepts at most this many OAuth scopes on a saved server. A longer list is left off so discovery keeps the server's own list. */
export const MCP_OAUTH_SCOPE_LIMIT = 32;

export interface PluginSkillsSource {
  owner: string;
  repo: string;
  /** Path inside the repo. Empty is the repository root. */
  path: string;
}

export interface PluginMcp {
  url: string;
  transport: PluginTransport;
  auth: PluginAuth;
  /** True when the authorization server's metadata advertised registration_endpoint. */
  dcr: boolean;
  scopes: string[];
  /** True only when a vendor document names this exact URL. Unverified URLs are never called. */
  verified: boolean;
  /** Public OAuth client id, filled by the app owner. Never a client secret. */
  clientId?: string;
  registrationDocsUrl?: string;
  probedAt: string;
}

export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  kind: PluginKind;
  docsUrl: string;
  skills?: PluginSkillsSource;
  mcp?: PluginMcp;
}

export type PluginAction =
  | { kind: "connect" }
  | { kind: "register"; docsUrl: string }
  | { kind: "token" }
  | { kind: "add" }
  | { kind: "manual"; docsUrl: string }
  | { kind: "install" };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GITHUB_PART = /^[\w.-]+$/;
const CLIENT_ID = /^[\x20-\x7e]+$/;
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  const text = value.trim();
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    // Keep the catalog string. URL.href would add a slash to an origin and move the loopback port.
    return text;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Public client id only. A secret, a blank, or Microsoft's Work IQ resource id is refused. */
export function publicClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 512 || !CLIENT_ID.test(id)) return null;
  if (/secret|private[_-]?key/i.test(id)) return null;
  if (id === "fdcc1f02-fc51-4226-8753-f668596af7f7") return null;
  return id;
}

function parseMcp(value: unknown, id: string): PluginMcp | { error: string } | undefined {
  if (value === undefined) return undefined;
  const mcp = record(value);
  if (!mcp) return { error: `${id}: mcp must be an object` };
  if ("clientSecret" in mcp || "client_secret" in mcp || "apiKey" in mcp || "api_key" in mcp) {
    return { error: `${id}: the catalog never stores a client secret or API key` };
  }
  const url = httpsUrl(mcp.url);
  if (!url) return { error: `${id}: mcp.url must be an https URL` };
  if (mcp.transport !== "http" && mcp.transport !== "sse") return { error: `${id}: mcp.transport must be http or sse` };
  if (mcp.auth !== "oauth" && mcp.auth !== "token" && mcp.auth !== "none") return { error: `${id}: mcp.auth must be oauth, token, or none` };
  if (typeof mcp.dcr !== "boolean") return { error: `${id}: mcp.dcr must be boolean` };
  if (typeof mcp.verified !== "boolean") return { error: `${id}: mcp.verified must be boolean` };
  if (!Array.isArray(mcp.scopes) || mcp.scopes.some((scope) => typeof scope !== "string" || !SCOPE.test(scope))) {
    return { error: `${id}: mcp.scopes must be scope tokens` };
  }
  if (typeof mcp.probedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(mcp.probedAt)) {
    return { error: `${id}: mcp.probedAt must be a date` };
  }
  let clientId: string | undefined;
  if (mcp.clientId !== undefined && mcp.clientId !== "") {
    const parsed = publicClientId(mcp.clientId);
    if (!parsed) return { error: `${id}: mcp.clientId must be a public client id` };
    clientId = parsed;
  }
  let registrationDocsUrl: string | undefined;
  if (mcp.registrationDocsUrl !== undefined) {
    const docs = httpsUrl(mcp.registrationDocsUrl);
    if (!docs) return { error: `${id}: registration docs must be an https URL` };
    registrationDocsUrl = docs;
  }
  if (mcp.auth === "none" && mcp.dcr) return { error: `${id}: a no-auth server does not use dynamic registration` };
  if (mcp.auth === "none" && clientId) return { error: `${id}: a no-auth server does not take a client id` };
  return {
    url,
    transport: mcp.transport,
    auth: mcp.auth,
    dcr: mcp.dcr,
    scopes: mcp.scopes,
    verified: mcp.verified,
    ...(clientId ? { clientId } : {}),
    ...(registrationDocsUrl ? { registrationDocsUrl } : {}),
    probedAt: mcp.probedAt,
  };
}

function parseSkills(value: unknown, id: string): PluginSkillsSource | { error: string } | undefined {
  if (value === undefined) return undefined;
  const skills = record(value);
  if (!skills) return { error: `${id}: skills must be an object` };
  if (typeof skills.owner !== "string" || !GITHUB_PART.test(skills.owner) || skills.owner === "." || skills.owner === "..") {
    return { error: `${id}: skills.owner is not a GitHub owner` };
  }
  if (typeof skills.repo !== "string" || !GITHUB_PART.test(skills.repo) || skills.repo === "." || skills.repo === "..") {
    return { error: `${id}: skills.repo is not a GitHub repository` };
  }
  if (typeof skills.path !== "string" || skills.path.length > 512 || skills.path.split("/").some((part) => part === "." || part === "..")) {
    return { error: `${id}: skills.path must stay inside the repository` };
  }
  return { owner: skills.owner, repo: skills.repo, path: skills.path };
}

export function parsePluginCatalog(value: unknown): PluginEntry[] | { error: string } {
  if (!Array.isArray(value)) return { error: "plugin catalog must be a list" };
  const entries: PluginEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const raw = record(item);
    if (!raw || typeof raw.id !== "string" || !ID.test(raw.id)) return { error: "each plugin needs an id of lowercase letters, numbers, and hyphens" };
    if (seen.has(raw.id)) return { error: `${raw.id} is listed twice` };
    seen.add(raw.id);
    if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 80) return { error: `${raw.id}: name is required` };
    if (typeof raw.description !== "string" || !raw.description.trim() || raw.description.length > 1_200) return { error: `${raw.id}: description is required` };
    if (!PLUGIN_CATEGORIES.includes(raw.category as PluginCategory)) return { error: `${raw.id}: unknown category` };
    if (raw.kind !== "connector" && raw.kind !== "skills" && raw.kind !== "both") return { error: `${raw.id}: kind must be connector, skills, or both` };
    const docsUrl = httpsUrl(raw.docsUrl);
    if (!docsUrl) return { error: `${raw.id}: docsUrl must be an https URL` };
    const mcp = parseMcp(raw.mcp, raw.id);
    if (mcp && "error" in mcp) return mcp;
    const skills = parseSkills(raw.skills, raw.id);
    if (skills && "error" in skills) return skills;
    if ((raw.kind === "skills" || raw.kind === "both") && !skills) return { error: `${raw.id}: a skills pack needs a GitHub source` };
    entries.push({
      id: raw.id,
      name: raw.name.trim(),
      description: raw.description.trim(),
      category: raw.category as PluginCategory,
      kind: raw.kind,
      docsUrl,
      ...(skills ? { skills } : {}),
      ...(mcp ? { mcp } : {}),
    });
  }
  return entries;
}

/** What the card offers. Unverified URLs never become Connect. An API key form is only for verified key-only auth. */
export function pluginActions(entry: PluginEntry): PluginAction[] {
  const actions: PluginAction[] = [];
  const mcp = entry.mcp;
  if (!mcp && entry.kind !== "skills") actions.push({ kind: "manual", docsUrl: entry.docsUrl });
  if (mcp) {
    const clientId = mcp.clientId?.trim();
    if (mcp.verified && mcp.auth === "oauth" && (mcp.dcr || clientId)) actions.push({ kind: "connect" });
    else if (mcp.verified && mcp.auth === "oauth") actions.push({ kind: "register", docsUrl: mcp.registrationDocsUrl || entry.docsUrl });
    else if (mcp.verified && mcp.auth === "token") actions.push({ kind: "token" });
    else if (mcp.verified && mcp.auth === "none" && !mcp.dcr && !clientId) actions.push({ kind: "add" });
    else actions.push({ kind: "manual", docsUrl: entry.docsUrl });
  }
  if ((entry.kind === "skills" || entry.kind === "both") && entry.skills) actions.push({ kind: "install" });
  return actions;
}

/** Saved with a pre-registered public client. Dynamic registration sends no client id; the server registers one. */
export function catalogOAuthBody(mcp: PluginMcp): { clientId: string; scopes?: string[] } | undefined {
  const clientId = mcp.clientId?.trim();
  if (!clientId || mcp.dcr || mcp.auth !== "oauth" || !mcp.verified) return undefined;
  const scopes = mcp.scopes.filter((scope) => SCOPE.test(scope));
  if (!scopes.length || scopes.length > MCP_OAUTH_SCOPE_LIMIT) return { clientId };
  return { clientId, scopes };
}

export function sameMcpUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    const path = (value: string) => value.replace(/\/+$/, "") || "/";
    return a.origin === b.origin && path(a.pathname) === path(b.pathname) && a.search === b.search && !a.username && !b.username;
  } catch {
    return false;
  }
}

/** Reuse a server already saved for this URL, so one Microsoft sign-in covers every card that shares it. */
export function catalogServerName(id: string, url: string, servers: readonly { name: string; url?: string }[]): string {
  const existing = servers.find((server) => server.url && sameMcpUrl(server.url, url));
  if (existing) return existing.name;
  const base = id.slice(0, 32);
  const taken = new Set(servers.map((server) => server.name));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const name = `${base}-${suffix}`.slice(0, 32);
    if (!taken.has(name)) return name;
  }
  return base;
}
