// The welcome flow's "Bring what you already use": finds the skills and MCP servers of a person's other AI tools on
// this computer and brings them in. It opens only the paths setupPaths names, plus the text files inside each skill
// folder; credential, session and history files are never listed, opened or copied, and nothing found leaves this
// computer. Skills are copied into every bot's own skills, switched on; MCP servers go through the same parser as
// Plugins → MCP servers → Paste config, switched off.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { SetupDetection, SetupImportRequest, SetupImportResult, SetupSource, SkillSkip, SkillSource, ToolSkip } from "../shared/setup-import.ts";
import { parseSkillMd, SKILL_FILE_MAX_BYTES } from "../shared/skill-md.ts";
import { isRemoteMcpServer, MAX_MCP_SERVERS, parseMcpServersImport, parseStoredMcpServer, type StoredMcpServer } from "./mcp-registry.ts";
import { directoryEntryState } from "./skill-storage.ts";
import { installSkill, listSkills, removeSkill, setSkillEnabled } from "./skills.ts";
import { parseToml } from "./toml-lite.ts";
import { workspaceDir } from "./workspace.ts";

/** The file operations finding and copying use, so tests can see every path touched. Each answers null on failure. */
export interface SetupFs {
  lstat(path: string): Stats | null;
  stat(path: string): Stats | null;
  readdir(path: string): string[] | null;
  /** A regular file of at most `max` bytes; `follow: false` refuses a symlink. */
  read(path: string, max: number, follow?: boolean): Buffer | null;
}

export interface SetupMachine {
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fs: SetupFs;
}

/** What finding and bringing in need from the server. */
export interface SetupHost {
  bots(): ReadonlyArray<{ id: string }>;
  /** The shared skills library's entries while it is switched on, null while it is off. */
  library(): Record<string, { sha256: string }> | null;
  mcpServers(): Record<string, unknown>;
  mcpPolicyRefusal(name: string, server: object): string | undefined;
  persistMcpServers(next: Record<string, unknown>): void;
  mcpConfigBusy: { get(): boolean; set(busy: boolean): void };
}

const nodeFs: SetupFs = {
  lstat: (path) => {
    try { return lstatSync(path); } catch { return null; }
  },
  stat: (path) => {
    try { return statSync(path); } catch { return null; }
  },
  readdir: (path) => {
    try { return readdirSync(path); } catch { return null; }
  },
  read: (path, max, follow = true) => {
    let fd: number | null = null;
    try {
      // Checked before opening, and opened non-blocking: a FIFO in place of a file must not hang the request.
      const before = follow ? statSync(path) : lstatSync(path);
      if (!before.isFile() || before.size > max) return null;
      const noFollow = !follow && process.platform !== "win32" ? constants.O_NOFOLLOW : 0;
      const nonBlock = process.platform !== "win32" ? constants.O_NONBLOCK : 0;
      fd = openSync(path, constants.O_RDONLY | noFollow | nonBlock);
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.size > max) return null;
      const buffer = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < buffer.length) {
        const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (count <= 0) break;
        offset += count;
      }
      return buffer.subarray(0, offset);
    } catch {
      return null;
    } finally {
      if (fd !== null) {
        try { closeSync(fd); } catch {}
      }
    }
  },
};

export function thisMachine(): SetupMachine {
  return { home: homedir(), platform: process.platform, env: process.env, fs: nodeFs };
}

type ToolFormat = "claudeJson" | "json" | "toml";

const CONFIG_MAX_BYTES = 1024 * 1024;
/** ~/.claude.json also keeps every project's history, so it can be large; only its mcpServers member is read. */
const CLAUDE_JSON_MAX_BYTES = 64 * 1024 * 1024;

/** Every path finding reads, and nothing else. */
export function setupPaths(machine: Pick<SetupMachine, "home" | "platform" | "env">) {
  const { home, platform, env } = machine;
  const absolute = (value: string | undefined) => (value && isAbsolute(value) ? value : null);
  const codexHome = absolute(env.CODEX_HOME) ?? join(home, ".codex");
  const desktop = platform === "darwin" ? join(home, "Library", "Application Support", "Claude")
    : platform === "win32" ? join(absolute(env.APPDATA) ?? join(home, "AppData", "Roaming"), "Claude")
      : join(home, ".config", "Claude");
  const codexLabel = codexHome === join(home, ".codex") ? "~/.codex/skills" : "$CODEX_HOME/skills";
  return {
    skills: [
      { source: "claudeCode", root: join(home, ".claude", "skills"), label: "~/.claude/skills" },
      { source: "codex", root: join(codexHome, "skills"), label: codexLabel },
    ] satisfies Array<{ source: SkillSource; root: string; label: string }>,
    tools: [
      { source: "claudeCode", path: join(home, ".claude.json"), format: "claudeJson", max: CLAUDE_JSON_MAX_BYTES },
      { source: "claudeDesktop", path: join(desktop, "claude_desktop_config.json"), format: "json", max: CONFIG_MAX_BYTES },
      { source: "cursor", path: join(home, ".cursor", "mcp.json"), format: "json", max: CONFIG_MAX_BYTES },
      { source: "codex", path: join(codexHome, "config.toml"), format: "toml", max: CONFIG_MAX_BYTES },
      { source: "gemini", path: join(home, ".gemini", "settings.json"), format: "json", max: CONFIG_MAX_BYTES },
    ] satisfies Array<{ source: SetupSource; path: string; format: ToolFormat; max: number }>,
  };
}

// ---- Skills ----

interface FoundSkill {
  name: string;
  source: SkillSource;
  folder: string;
  /** Where it came from, as the bot's Skills settings show it. */
  label: string;
  text: string;
  sha256: string;
}

const MAX_SKILL_FOLDERS = 500;

/** Credentials, sessions, history, transcripts, logs and caches inside a skill folder: never opened or copied. */
export function privateName(name: string): boolean {
  const lower = name.toLowerCase();
  return /auth[^/\\]*\.json$/.test(lower) || lower.includes("credential") || lower.includes("secret") || lower.startsWith("history") ||
    /^(?:sessions|archived_sessions|projects|logs?|cache|shell-snapshots|statsig|todos)$/.test(lower) ||
    /\.(?:pem|key|p12|pfx|keychain|keychain-db|sqlite3?|db|log)$/.test(lower) || /^id_(?:rsa|dsa|ecdsa|ed25519)/.test(lower);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Skill folders with a valid SKILL.md, Claude Code's first; a name found twice keeps its first folder. */
function findSkills(machine: SetupMachine): FoundSkill[] {
  const found: FoundSkill[] = [];
  const names = new Set<string>();
  for (const { source, root, label } of setupPaths(machine).skills) {
    // Dot folders hold the tools' own built-in skills (Codex's .system), not the person's.
    const folders = (machine.fs.readdir(root) ?? []).filter((folder) => !folder.startsWith(".")).sort().slice(0, MAX_SKILL_FOLDERS);
    for (const folder of folders) {
      const dir = join(root, folder);
      if (!machine.fs.stat(dir)?.isDirectory()) continue;
      const bytes = machine.fs.read(join(dir, "SKILL.md"), SKILL_FILE_MAX_BYTES, false);
      const text = bytes ? utf8(bytes) : null;
      const parsed = text === null ? null : parseSkillMd(text);
      if (!parsed || "error" in parsed || names.has(parsed.name)) continue;
      names.add(parsed.name);
      found.push({ name: parsed.name, source, folder: dir, label: `${label}/${folder}`, text: text!, sha256: sha256(text!) });
    }
  }
  return found;
}

/** Copied beside SKILL.md: scripts, references and templates, as text. */
const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "mdx", "txt", "text", "rst", "adoc", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "sh", "bash", "zsh",
  "fish", "ps1", "bat", "cmd", "rb", "go", "rs", "java", "kt", "kts", "swift", "php", "pl", "lua", "r", "sql", "json",
  "jsonc", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf", "csv", "tsv", "xml", "xsd", "xsl", "xslt", "html", "htm",
  "css", "scss", "svg", "tex", "j2", "jinja", "jinja2", "tmpl", "tpl", "template", "hbs", "mustache", "graphql", "gql",
  "proto", "c", "h", "cc", "cpp", "hpp", "cs", "vue", "svelte", "dart", "scala", "ex", "exs", "hs", "clj", "el", "vim",
]);
const TEXT_NAMES = new Set(["makefile", "dockerfile", "license", "readme", "notice", "gemfile", "procfile", "justfile"]);
/** Installed dependencies, rebuilt where the skill runs; .git and .venv are dot folders, skipped already. */
const SKIPPED_FOLDERS = new Set(["node_modules", "__pycache__", "venv"]);

export const SKILL_COPY_LIMITS = {
  fileBytes: 512 * 1024,
  skillBytes: 4 * 1024 * 1024,
  skillFiles: 200,
  totalBytes: 48 * 1024 * 1024,
  depth: 6,
};

interface SkillFile {
  path: string;
  content: string;
  executable: boolean;
}

function textFile(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot > 0 ? TEXT_EXTENSIONS.has(lower.slice(dot + 1)) : TEXT_NAMES.has(lower);
}

const decoder = new TextDecoder("utf-8", { fatal: true });
function utf8(bytes: Buffer): string | null {
  try {
    const text = decoder.decode(bytes);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

/** The text files beside SKILL.md, within the limits. Symlinks are never followed; anything left out is counted. */
function skillFiles(fs: SetupFs, dir: string, budget: { bytes: number }): { files: SkillFile[]; leftOut: number } {
  const files: SkillFile[] = [];
  let leftOut = 0;
  let bytes = 0;
  const walk = (folder: string, relative: string, depth: number) => {
    for (const name of (fs.readdir(folder) ?? []).sort()) {
      // Decided by name before anything is opened.
      if (name.startsWith(".") || privateName(name)) continue;
      const path = relative ? `${relative}/${name}` : name;
      if (path === "SKILL.md") continue;
      const full = join(folder, name);
      const info = fs.lstat(full);
      if (!info) continue;
      if (info.isSymbolicLink()) {
        leftOut += 1;
      } else if (info.isDirectory()) {
        if (SKIPPED_FOLDERS.has(name.toLowerCase())) continue;
        if (depth >= SKILL_COPY_LIMITS.depth) leftOut += 1;
        else walk(full, path, depth + 1);
      } else if (info.isFile()) {
        const fits = textFile(name) && info.size <= SKILL_COPY_LIMITS.fileBytes && files.length < SKILL_COPY_LIMITS.skillFiles &&
          bytes + info.size <= SKILL_COPY_LIMITS.skillBytes && budget.bytes + info.size <= SKILL_COPY_LIMITS.totalBytes;
        const raw = fits ? fs.read(full, SKILL_COPY_LIMITS.fileBytes, false) : null;
        const content = raw ? utf8(raw) : null;
        if (content === null) {
          leftOut += 1;
          continue;
        }
        files.push({ path, content, executable: (info.mode & 0o111) !== 0 });
        bytes += raw!.length;
        budget.bytes += raw!.length;
      }
    }
  };
  walk(dir, "", 0);
  return { files, leftOut };
}

/** Into the folder installSkill just made, level by level, never through a symlink and never over a file. */
function writeSkillFiles(root: string, files: readonly SkillFile[]) {
  if (directoryEntryState(root) !== "directory") throw new Error("the skill folder is not a real directory");
  for (const file of files) {
    const parts = file.path.split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      folder = join(folder, part);
      const state = directoryEntryState(folder);
      if (state === "missing") mkdirSync(folder, { mode: 0o700 });
      else if (state !== "directory") throw new Error("a skill folder is not a real directory");
    }
    writeFileSync(join(folder, parts[parts.length - 1]!), file.content, { mode: file.executable ? 0o700 : 0o600, flag: "wx" });
  }
}

/** Installed off first, files added, then switched on, so a bot never sees a half-copied skill. */
function installForBot(botId: string, skill: FoundSkill, files: readonly SkillFile[]): boolean {
  const installed = installSkill(botId, skill.label, [{ path: "SKILL.md", content: skill.text }]);
  if ("error" in installed) return false;
  try {
    writeSkillFiles(join(workspaceDir(botId), "skills", skill.name), files);
  } catch {
    removeSkill(botId, skill.name);
    return false;
  }
  return !("error" in setSkillEnabled(botId, skill.name, true));
}

type BotSkills = Map<string, Map<string, string>>;
const botSkills = (bots: ReadonlyArray<{ id: string }>): BotSkills =>
  new Map(bots.map((bot) => [bot.id, new Map(listSkills(bot.id).map((skill) => [skill.name, skill.sha256]))]));

/** New when the library (while on) does not have the name and at least one bot has no skill by that name. */
function freshSkill(skill: FoundSkill, owned: BotSkills, library: Record<string, unknown> | null): boolean {
  if (library && Object.hasOwn(library, skill.name)) return false;
  return [...owned.values()].some((names) => !names.has(skill.name));
}

function importSkills(machine: SetupMachine, host: SetupHost): NonNullable<SetupImportResult["skills"]> {
  const bots = host.bots();
  const library = host.library();
  const owned = botSkills(bots);
  const budget = { bytes: 0 };
  const result: NonNullable<SetupImportResult["skills"]> = { added: [], present: [], skipped: [], filesLeftOut: 0 };
  const skip = (name: string, reason: SkillSkip) => result.skipped.push({ name, reason });
  for (const skill of findSkills(machine)) {
    const shelved = library && Object.hasOwn(library, skill.name) ? library[skill.name]! : null;
    if (shelved) {
      if (shelved.sha256 === skill.sha256) result.present.push(skill.name);
      else skip(skill.name, "conflict");
      continue;
    }
    const targets = bots.filter((bot) => !owned.get(bot.id)?.has(skill.name));
    if (!targets.length) {
      if (bots.length && bots.every((bot) => owned.get(bot.id)?.get(skill.name) === skill.sha256)) result.present.push(skill.name);
      else if (bots.length) skip(skill.name, "conflict");
      continue;
    }
    const copy = skillFiles(machine.fs, skill.folder, budget);
    result.filesLeftOut += copy.leftOut;
    const added = targets.filter((bot) => installForBot(bot.id, skill, copy.files)).length;
    if (added) result.added.push(skill.name);
    else skip(skill.name, "failed");
  }
  return result;
}

// ---- MCP servers ----

interface FoundTool {
  name: string;
  source: SetupSource;
  server: StoredMcpServer;
  identity: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function skipString(text: string, start: number): number {
  for (let at = start + 1; ;) {
    const quote = text.indexOf('"', at);
    if (quote < 0) return -1;
    let slashes = 0;
    while (text[quote - 1 - slashes] === "\\") slashes++;
    if (slashes % 2 === 0) return quote + 1;
    at = quote + 1;
  }
}

function skipValue(text: string, start: number): number {
  if (text[start] === '"') return skipString(text, start);
  if (text[start] !== "{" && text[start] !== "[") {
    let at = start;
    while (at < text.length && !/[\s,}\]]/.test(text[at]!)) at++;
    return at > start ? at : -1;
  }
  let depth = 0;
  for (let at = start; at < text.length;) {
    const char = text[at]!;
    if (char === '"') {
      at = skipString(text, at);
      if (at < 0) return -1;
      continue;
    }
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return at + 1;
    }
    at++;
  }
  return -1;
}

/** One top-level member's value, found by skipping every other member unparsed; null when absent or malformed. */
export function topLevelJsonMember(text: string, name: string): unknown {
  const spaces = (at: number) => {
    while (at < text.length && /\s/.test(text[at]!)) at++;
    return at;
  };
  let at = spaces(text.charCodeAt(0) === 0xfeff ? 1 : 0);
  if (text[at] !== "{") return null;
  let found: string | null = null;
  at = spaces(at + 1);
  if (text[at] === "}") return null;
  for (;;) {
    if (text[at] !== '"') return null;
    const keyEnd = skipString(text, at);
    if (keyEnd < 0) return null;
    let key: unknown;
    try { key = JSON.parse(text.slice(at, keyEnd)); } catch { return null; }
    at = spaces(keyEnd);
    if (text[at] !== ":") return null;
    at = spaces(at + 1);
    const valueEnd = skipValue(text, at);
    if (valueEnd < 0) return null;
    // The last of a repeated member wins, as in JSON.parse.
    if (key === name) found = text.slice(at, valueEnd);
    at = spaces(valueEnd);
    if (text[at] === ",") {
      at = spaces(at + 1);
      continue;
    }
    if (text[at] !== "}" || found === null) return null;
    try { return JSON.parse(found); } catch { return null; }
  }
}

/** Gemini CLI and some editors allow comments in their settings JSON. */
export function withoutJsonComments(text: string): string {
  let out = "";
  for (let at = 0; at < text.length;) {
    const char = text[at]!;
    if (char === '"') {
      const end = skipString(text, at);
      if (end < 0) return out + text.slice(at);
      out += text.slice(at, end);
      at = end;
    } else if (char === "/" && text[at + 1] === "/") {
      while (at < text.length && text[at] !== "\n") at++;
    } else if (char === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 2;
    } else {
      out += char;
      at++;
    }
  }
  return out;
}

/** Strings, numbers and booleans as text; anything else is dropped. */
function textValues(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") out[key] = String(entry);
  }
  return out;
}

/** Each tool's entry in the {"mcpServers": …} shape Paste config takes. Token variables are not resolved: the person
 * adds the token as a header when they test the server. */
function pasteEntry(source: SetupSource, raw: Record<string, unknown>): Record<string, unknown> {
  const headers = textValues(source === "codex" ? raw.http_headers : raw.headers);
  const remote = (type: "http" | "sse", url: unknown) => ({ type, url, ...(headers ? { headers } : {}) });
  if (source === "gemini") {
    if (typeof raw.httpUrl === "string") return remote("http", raw.httpUrl);
    if (typeof raw.url === "string") return remote(raw.type === "http" ? "http" : "sse", raw.url);
  } else if (typeof raw.url === "string") {
    return remote(typeof raw.type === "string" && /sse/i.test(raw.type) ? "sse" : "http", raw.url);
  }
  const env = textValues(raw.env);
  return {
    command: raw.command,
    ...(Array.isArray(raw.args) ? { args: raw.args.map((arg) => (typeof arg === "number" ? String(arg) : arg)) } : {}),
    ...(env ? { env } : {}),
  };
}

function identity(server: StoredMcpServer): string {
  if (!isRemoteMcpServer(server)) return `command ${JSON.stringify([server.command, ...server.args])}`;
  try {
    return `url ${new URL(server.url).href}`;
  } catch {
    return `url ${server.url.trim()}`;
  }
}

/** The raw {name: entry} map one tool keeps; null when the file is missing or cannot be read. */
function toolEntries(machine: SetupMachine, tool: ReturnType<typeof setupPaths>["tools"][number]): Record<string, unknown> | null {
  const bytes = machine.fs.read(tool.path, tool.max);
  const text = bytes ? utf8(bytes) : null;
  if (text === null) return null;
  try {
    if (tool.format === "claudeJson") {
      const servers = topLevelJsonMember(text, "mcpServers");
      return isRecord(servers) ? servers : null;
    }
    const parsed: unknown = tool.format === "toml" ? parseToml(text) : JSON.parse(withoutJsonComments(text));
    const servers = isRecord(parsed) ? parsed[tool.format === "toml" ? "mcp_servers" : "mcpServers"] : undefined;
    return isRecord(servers) ? servers : null;
  } catch {
    return null;
  }
}

/** Every server the tools list, normalised and switched off by Paste config's parser, sorted into new, already here,
 * and refused by the organization; a server two tools list is kept once. */
function findTools(machine: SetupMachine, current: Record<string, unknown>, refusal: SetupHost["mcpPolicyRefusal"]) {
  const existing = Object.entries(current).flatMap(([name, raw]) => {
    const parsed = parseStoredMcpServer(name, raw);
    return parsed.ok ? [identity(parsed.server)] : [];
  });
  const takenNames = new Set(Object.keys(current));
  const takenIds = new Set(existing);
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const fresh: FoundTool[] = [];
  const present: FoundTool[] = [];
  const refused: FoundTool[] = [];
  for (const tool of setupPaths(machine).tools) {
    const entries = toolEntries(machine, tool);
    for (const [rawName, raw] of Object.entries(entries ?? {})) {
      if (!isRecord(raw)) continue;
      const parsed = parseMcpServersImport(JSON.stringify({ mcpServers: { [rawName]: pasteEntry(tool.source, raw) } }));
      if (!parsed.ok) continue;
      const [name, server] = Object.entries(parsed.servers)[0]!;
      const found: FoundTool = { name, source: tool.source, server, identity: identity(server) };
      if (seenNames.has(name) || seenIds.has(found.identity)) continue;
      seenNames.add(name);
      seenIds.add(found.identity);
      if (takenNames.has(name) || takenIds.has(found.identity)) present.push(found);
      else if (refusal(name, server)) refused.push(found);
      else fresh.push(found);
    }
  }
  return { fresh, present, refused };
}

function importTools(machine: SetupMachine, host: SetupHost): NonNullable<SetupImportResult["tools"]> {
  const skipped = (tools: FoundTool[], reason: ToolSkip) => tools.map((tool) => ({ name: tool.name, reason }));
  // Single-flight with the MCP servers routes: a read of the list must not interleave with another save.
  if (host.mcpConfigBusy.get()) {
    return { added: [], present: [], skipped: skipped(findTools(machine, host.mcpServers(), host.mcpPolicyRefusal).fresh, "busy") };
  }
  host.mcpConfigBusy.set(true);
  try {
    const current = host.mcpServers();
    const { fresh, present, refused } = findTools(machine, current, host.mcpPolicyRefusal);
    const room = Math.max(0, MAX_MCP_SERVERS - Object.keys(current).length);
    const adding = fresh.slice(0, room);
    if (adding.length) {
      host.persistMcpServers({ ...current, ...Object.fromEntries(adding.map((tool) => [tool.name, { ...tool.server, enabled: false }])) });
    }
    return {
      added: adding.map((tool) => tool.name),
      present: present.map((tool) => tool.name),
      skipped: [...skipped(fresh.slice(room), "limit"), ...skipped(refused, "policy")],
    };
  } finally {
    host.mcpConfigBusy.set(false);
  }
}

// ---- Finding and bringing in ----

/** What is new here, by name and source; an empty list when nothing is. */
export function detectSetup(machine: SetupMachine, host: SetupHost): SetupDetection {
  const owned = botSkills(host.bots());
  const library = host.library();
  const skills = owned.size
    ? findSkills(machine).filter((skill) => freshSkill(skill, owned, library)).map(({ name, source }) => ({ name, source }))
    : [];
  const current = host.mcpServers();
  const tools = Object.keys(current).length < MAX_MCP_SERVERS
    ? findTools(machine, current, host.mcpPolicyRefusal).fresh.map(({ name, source }) => ({ name, source }))
    : [];
  return { skills, tools };
}

export function applySetupImport(machine: SetupMachine, host: SetupHost, request: SetupImportRequest): SetupImportResult {
  return {
    ...(request.skills ? { skills: importSkills(machine, host) } : {}),
    ...(request.tools ? { tools: importTools(machine, host) } : {}),
  };
}
