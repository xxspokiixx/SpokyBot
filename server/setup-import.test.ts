import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { IMPORTED_SKILLS_DIR, importedSkillsFor, readImportedSkills } from "./imported-skills.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import {
  applySetupImport, detectSetup, privateName, setupPaths, SKILL_COPY_LIMITS, thisMachine, topLevelJsonMember, withoutJsonComments,
  type SetupFs, type SetupHost, type SetupMachine,
} from "./setup-import.ts";
import { installSkill, listSkills } from "./skills.ts";
import { workspaceDir } from "./workspace.ts";

// Every home here is a fresh temporary folder; nothing reads the real ~/.claude, ~/.codex or other dotfiles.
const SENTINEL = "SENTINEL-credential-7f3a91";
const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => removeTempDir(home)));
  // This computer's imported skills are one set for the whole data folder: each test starts without any.
  rmSync(IMPORTED_SKILLS_DIR, { recursive: true, force: true });
  rmSync(join(DATA_DIR, "skill-state", "imported-skills.json"), { force: true });
});

function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), "omb-setup-import-home-"));
  homes.push(home);
  return home;
}

function put(home: string, path: string, content: string | Buffer, mode?: number) {
  const full = join(home, ...path.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  if (mode !== undefined) chmodSync(full, mode);
  return full;
}

const skillMd = (name: string, body = "Run scripts/extract.py on the file.") =>
  `---\nname: ${name}\ndescription: Works with ${name} files.\n---\n\n# ${name}\n\n${body}\n`;

/** Records every path finding or copying touches. */
function machineFor(home: string, platform: NodeJS.Platform = "darwin", env: Record<string, string | undefined> = {}) {
  const touched: string[] = [];
  const real = thisMachine().fs;
  const fs: SetupFs = {
    lstat: (path) => { touched.push(path); return real.lstat(path); },
    stat: (path) => { touched.push(path); return real.stat(path); },
    readdir: (path) => { touched.push(path); return real.readdir(path); },
    read: (path, max, follow) => { touched.push(path); return real.read(path, max, follow); },
  };
  const machine: SetupMachine = { home, platform, env, fs };
  return { machine, touched };
}

function hostFor(options: { servers?: Record<string, unknown>; refuse?: string[] } = {}) {
  let servers = options.servers ?? {};
  let busy = false;
  const saves: Array<Record<string, unknown>> = [];
  const host: SetupHost = {
    mcpServers: () => servers,
    mcpPolicyRefusal: (name) => (options.refuse?.includes(name) ? "Not on your organization's approved list." : undefined),
    persistMcpServers: (next) => {
      servers = next;
      saves.push(next);
    },
    mcpConfigBusy: { get: () => busy, set: (value) => { busy = value; } },
  };
  return { host, saves, servers: () => servers, busy: { set: (value: boolean) => { busy = value; } } };
}

const newBot = () => `bot-${randomUUID().slice(0, 8)}`;

function plantTools(home: string) {
  put(home, ".claude.json", JSON.stringify({
    numStartups: 41,
    oauthAccount: { emailAddress: "someone@example.test", accessToken: SENTINEL },
    projects: { "/Users/someone/app": { history: [{ display: SENTINEL }], mcpServers: { "project-only": { command: "project-tool" } } } },
    mcpServers: {
      github: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "ghp_secret_value" } },
      linear: { type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer lin_secret_value" } },
    },
    userID: SENTINEL,
  }));
  put(home, "Library/Application Support/Claude/claude_desktop_config.json", JSON.stringify({
    mcpServers: {
      filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/someone/Documents"] },
      github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    },
    preferences: { quickEntryShortcut: "off" },
  }));
  put(home, ".cursor/mcp.json", JSON.stringify({
    mcpServers: { "Linear MCP": { url: "https://mcp.linear.app/mcp" }, notion: { url: "https://mcp.notion.com/mcp" } },
  }));
  put(home, ".codex/config.toml", [
    'model = "gpt-5.5"',
    "[mcp_servers.sentry]",
    'command = "npx"',
    'args = ["-y", "@sentry/mcp-server"]',
    "[mcp_servers.sentry.env]",
    'SENTRY_TOKEN = "sntrys_secret_value"',
    "[mcp_servers.figma]",
    'url = "https://mcp.figma.com/mcp"',
    'bearer_token_env_var = "FIGMA_TOKEN"',
  ].join("\n"));
  put(home, ".gemini/settings.json", `{
    // Gemini CLI allows comments here
    "theme": "GitHub",
    "mcpServers": {
      "context7": { "httpUrl": "https://mcp.context7.com/mcp" },
      "legacy": { "url": "https://legacy.example.test/sse" }, /* an SSE server */
      "local-tool": { "command": "node", "args": ["server.js", 8080], "cwd": "/somewhere", "trust": true }
    }
  }`);
}

/** Credentials, sessions, history and transcripts that must never be opened, each holding the sentinel. */
function plantPrivateFiles(home: string): string[] {
  return [
    ".claude/.credentials.json", ".codex/auth.json", ".claude/history.jsonl", ".codex/history.jsonl",
    ".claude/projects/-Users-someone-app/0b1c.jsonl", ".codex/sessions/2026/10/16/rollout-1.jsonl",
    ".codex/archived_sessions/rollout-0.jsonl", ".claude/logs/claude.log", ".gemini/oauth_creds.json",
    ".gemini/google_accounts.json", ".claude/statsig/cache.json",
  ].map((path) => put(home, path, SENTINEL));
}

function plantSkills(home: string) {
  put(home, ".claude/skills/pdf/SKILL.md", skillMd("pdf"));
  put(home, ".claude/skills/pdf/scripts/extract.py", "print('extract')\n", 0o755);
  put(home, ".claude/skills/pdf/references/forms.md", "# Forms\n");
  put(home, ".claude/skills/pdf/assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0xff, 0xfe]));
  put(home, ".claude/skills/pdf/big.md", "x".repeat(SKILL_COPY_LIMITS.fileBytes + 1));
  put(home, ".claude/skills/pdf/node_modules/left-pad/index.js", "module.exports = 1;\n");
  put(home, ".claude/skills/pdf/.git/config", SENTINEL);
  put(home, ".claude/skills/pdf/auth.json", SENTINEL);
  put(home, ".claude/skills/pdf/.credentials.json", SENTINEL);
  put(home, ".claude/skills/pdf/notes/.env", SENTINEL);
  put(home, ".claude/skills/pdf/secrets/token.txt", SENTINEL);
  put(home, ".claude/skills/pdf/history.txt", SENTINEL);
  put(home, ".claude/skills/pdf/sessions/last.json", SENTINEL);
  symlinkSync(join(home, ".codex", "auth.json"), join(home, ".claude", "skills", "pdf", "linked.md"));
  put(home, ".claude/skills/broken/SKILL.md", "no frontmatter here\n");
  put(home, ".claude/skills/loose-file.md", skillMd("loose-file"));
  put(home, ".claude/skills/.hidden/SKILL.md", skillMd("hidden"));
  put(home, ".codex/skills/.system/skill-creator/SKILL.md", skillMd("skill-creator"));
  put(home, ".codex/skills/review/SKILL.md", skillMd("review", "Review the diff."));
  put(home, ".codex/skills/pdf/SKILL.md", skillMd("pdf", "A different pdf skill."));
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" }).map((path) => path.split(sep).join("/")).sort();
}

function contentsUnder(root: string): string {
  return filesUnder(root).map((path) => {
    const full = join(root, path);
    return statSync(full).isFile() ? readFileSync(full, "utf8") : "";
  }).join("\n");
}

describe("finding what another AI tool already set up on this computer", () => {
  it("finds nothing in an empty home", () => {
    const { machine } = machineFor(fixtureHome());
    expect(detectSetup(machine, hostFor().host)).toEqual({ skills: [], tools: [] });
  });

  it("lists each valid skill once by name, Claude Code first, skipping dot folders, loose files and broken SKILL.md", () => {
    const home = fixtureHome();
    plantSkills(home);
    const { machine } = machineFor(home);
    expect(detectSetup(machine, hostFor().host).skills).toEqual([
      { name: "pdf", source: "claudeCode" },
      { name: "review", source: "codex" },
    ]);
  });

  it("offers a skill until it is brought in, again once it or its copy changes, and never one another folder's skill named so", () => {
    const home = fixtureHome();
    plantSkills(home);
    const { machine } = machineFor(home);
    const { host } = hostFor();
    // No bot is needed: the skills are kept once for all of them.
    expect(detectSetup(machine, host).skills.map((skill) => skill.name)).toEqual(["pdf", "review"]);
    applySetupImport(machine, host, { skills: true });
    expect(detectSetup(machine, host).skills).toEqual([]);
    // A bot made afterwards changes nothing here.
    installSkill(newBot(), "elsewhere", [{ path: "SKILL.md", content: skillMd("review", "Something else.") }]);
    expect(detectSetup(machine, host).skills).toEqual([]);
    put(home, ".claude/skills/pdf/SKILL.md", skillMd("pdf", "A newer pdf skill."));
    expect(detectSetup(machine, host).skills).toEqual([{ name: "pdf", source: "claudeCode" }]);
    applySetupImport(machine, host, { skills: true });
    const copy = join(IMPORTED_SKILLS_DIR, "review", "SKILL.md");
    chmodSync(copy, 0o600);
    writeFileSync(copy, skillMd("review", "Edited by a bot."));
    expect(detectSetup(machine, host).skills).toEqual([{ name: "review", source: "codex" }]);
    // Another tool's skill by the same name is a different skill: it is not offered, and bringing in skips it.
    rmSync(join(home, ".codex", "skills", "review"), { recursive: true });
    put(home, ".claude/skills/review-copy/SKILL.md", skillMd("review", "Another review skill."));
    expect(detectSetup(machine, host).skills).toEqual([]);
    expect(applySetupImport(machine, host, { skills: true }).skills?.skipped).toEqual([{ name: "review", reason: "conflict" }]);
  });

  it("reads MCP servers from Claude Code, Claude Desktop, Cursor, Codex and Gemini CLI, each server once", () => {
    const home = fixtureHome();
    plantTools(home);
    const { machine } = machineFor(home);
    expect(detectSetup(machine, hostFor().host).tools).toEqual([
      { name: "github", source: "claudeCode" },
      { name: "linear", source: "claudeCode" },
      { name: "filesystem", source: "claudeDesktop" },
      { name: "notion", source: "cursor" },
      { name: "sentry", source: "codex" },
      { name: "figma", source: "codex" },
      { name: "context7", source: "gemini" },
      { name: "legacy", source: "gemini" },
      { name: "local-tool", source: "gemini" },
    ]);
  });

  it("finds Claude Desktop's config where each system keeps it", () => {
    for (const [platform, path, env] of [
      ["win32", "Roaming/Claude/claude_desktop_config.json", { APPDATA: "Roaming" }],
      ["linux", ".config/Claude/claude_desktop_config.json", {}],
    ] as const) {
      const home = fixtureHome();
      put(home, path, JSON.stringify({ mcpServers: { memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } } }));
      const appData = "APPDATA" in env ? { APPDATA: join(home, env.APPDATA) } : {};
      const { machine } = machineFor(home, platform, appData);
      expect(detectSetup(machine, hostFor().host).tools, platform).toEqual([{ name: "memory", source: "claudeDesktop" }]);
    }
  });

  it("skips a missing or malformed config and still reads the others", () => {
    const home = fixtureHome();
    put(home, ".cursor/mcp.json", "{ not json");
    put(home, ".codex/config.toml", "[mcp_servers.x\ncommand = 1");
    put(home, ".claude.json", '{"mcpServers": {"half": ');
    put(home, ".gemini/settings.json", JSON.stringify({ mcpServers: { ok: { command: "ok-tool" }, bad: { args: ["no command"] }, list: [] } }));
    const { machine } = machineFor(home);
    expect(detectSetup(machine, hostFor().host).tools).toEqual([{ name: "ok", source: "gemini" }]);
  });

  it("leaves out servers already here by name, command or address, ones the organization refuses, and all of them when the list is full", () => {
    const home = fixtureHome();
    plantTools(home);
    const { machine } = machineFor(home);
    const servers = {
      notion: { type: "http", url: "https://mcp.notion.com/mcp", headers: {}, enabled: true },
      gh: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: {}, enabled: false },
    };
    const names = detectSetup(machine, hostFor({ servers, refuse: ["filesystem"] }).host).tools.map((tool) => tool.name);
    expect(names).toEqual(["linear", "sentry", "figma", "context7", "legacy", "local-tool"]);
    const full = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`s${i}`, { command: `tool-${i}`, args: [], env: {}, enabled: false }]));
    expect(detectSetup(machine, hostFor({ servers: full }).host).tools).toEqual([]);
  });

  it("never lists, opens or returns a credential, session, history or transcript file", () => {
    const home = fixtureHome();
    plantTools(home);
    plantSkills(home);
    const planted = plantPrivateFiles(home);
    const { machine, touched } = machineFor(home);
    const { host, servers } = hostFor();
    const detection = detectSetup(machine, host);
    const result = applySetupImport(machine, host, { skills: true, tools: true });

    const allowed = setupPaths(machine);
    const roots = allowed.skills.map((skill) => skill.root);
    const files = new Set(allowed.tools.map((tool) => tool.path));
    const stray = touched.filter((path) => !files.has(path) && !roots.some((root) => path === root || path.startsWith(root + sep)));
    expect(stray).toEqual([]);
    for (const path of planted) expect(touched).not.toContain(path);
    const inSkills = touched.filter((path) => roots.some((root) => path.startsWith(root + sep))).map((path) => relative(home, path));
    expect(inSkills.filter((path) => path.split(sep).some((part) => part.startsWith(".") && part !== ".claude" && part !== ".codex"))).toEqual([]);
    expect(inSkills.filter((path) => path.split(sep).some(privateName))).toEqual([]);

    const said = JSON.stringify({ detection, result, saved: servers() });
    expect(said).not.toContain(SENTINEL);
    expect(said).not.toContain("project-only");
    expect(JSON.stringify({ detection, result })).not.toMatch(/ghp_secret_value|lin_secret_value|sntrys_secret_value/);
    expect(contentsUnder(IMPORTED_SKILLS_DIR)).not.toContain(SENTINEL);
  });

  it("reads one top-level JSON member without parsing the rest", () => {
    const text = `{"a": {"mcpServers": {"nested": 1}}, "b": "}\\"{", "mcpServers": {"x": {"command": "y"}}, "c": [1, {"d": null}], "e": -2.5e3}`;
    expect(topLevelJsonMember(text, "mcpServers")).toEqual({ x: { command: "y" } });
    expect(topLevelJsonMember(text, "missing")).toBeNull();
    expect(topLevelJsonMember('{"mcpServers": {"x": 1}, "mcpServers": {"y": 2}}', "mcpServers")).toEqual({ y: 2 });
    for (const bad of ["", "[]", '{"mcpServers": ', '{"mcpServers": {"x": 1}', '{"mcpServers" {"x": 1}}']) {
      expect(topLevelJsonMember(bad, "mcpServers"), bad).toBeNull();
    }
    expect(JSON.parse(withoutJsonComments('{ // note\n "a": "http://x//y", /* block */ "b": 1 }'))).toEqual({ a: "http://x//y", b: 1 });
  });
});

describe("bringing skills in", () => {
  it("copies each skill's text files once, read-only, for every bot, and leaves out binary, oversized, linked and private files", () => {
    const home = fixtureHome();
    plantSkills(home);
    plantPrivateFiles(home);
    const { machine } = machineFor(home);
    const { host } = hostFor();
    const result = applySetupImport(machine, host, { skills: true });
    expect(result).toEqual({ skills: { added: ["pdf", "review"], present: [], skipped: [], filesLeftOut: 3 } });
    const folder = join(IMPORTED_SKILLS_DIR, "pdf");
    expect(filesUnder(folder)).toEqual(["SKILL.md", "references", "references/forms.md", "scripts", "scripts/extract.py"]);
    expect(readFileSync(join(folder, "SKILL.md"), "utf8")).toBe(skillMd("pdf"));
    if (process.platform !== "win32") {
      expect(statSync(join(folder, "scripts", "extract.py")).mode & 0o777).toBe(0o500);
      expect(statSync(join(folder, "references", "forms.md")).mode & 0o777).toBe(0o400);
    }
    expect(readImportedSkills().pdf).toMatchObject({
      source: "claudeCode", label: "~/.claude/skills/pdf", root: join(home, ".claude", "skills"), origin: join(home, ".claude", "skills", "pdf"),
    });
    // Nothing is written into any bot: a bot made before or after uses the same copy.
    const before = newBot();
    expect(existsSync(workspaceDir(before))).toBe(false);
    for (const bot of [before, newBot()]) expect(importedSkillsFor(bot, new Set()).map((skill) => skill.name)).toEqual(["pdf", "review"]);
  });

  it("adds a skill once: a second run finds it present and changes nothing", () => {
    const home = fixtureHome();
    put(home, ".claude/skills/pdf/SKILL.md", skillMd("pdf"));
    const { machine } = machineFor(home);
    const { host } = hostFor();
    expect(applySetupImport(machine, host, { skills: true }).skills?.added).toEqual(["pdf"]);
    const stored = readImportedSkills().pdf;
    expect(applySetupImport(machine, host, { skills: true })).toEqual({ skills: { added: [], present: ["pdf"], skipped: [], filesLeftOut: 0 } });
    expect(readImportedSkills().pdf).toEqual(stored);
    expect(detectSetup(machine, host).skills).toEqual([]);
  });

  it("never touches a bot's own skill of the same name: that bot keeps its own, the others get the one brought in", () => {
    const home = fixtureHome();
    put(home, ".claude/skills/pdf/SKILL.md", skillMd("pdf"));
    const { machine } = machineFor(home);
    const mine = newBot();
    installSkill(mine, "my own", [{ path: "SKILL.md", content: skillMd("pdf", "My own version.") }]);
    expect(applySetupImport(machine, hostFor().host, { skills: true }).skills?.added).toEqual(["pdf"]);
    expect(readFileSync(join(workspaceDir(mine), "skills", "pdf", "SKILL.md"), "utf8")).toContain("My own version.");
    expect(listSkills(mine).map((skill) => skill.source)).toEqual(["my own"]);
    expect(importedSkillsFor(mine, new Set(listSkills(mine).map((skill) => skill.name)))).toEqual([]);
    expect(importedSkillsFor(newBot(), new Set()).map((skill) => skill.name)).toEqual(["pdf"]);
  });

  it("stops copying a skill's files at its file count, and every skill's at the total size", () => {
    const home = fixtureHome();
    put(home, ".claude/skills/many/SKILL.md", skillMd("many"));
    for (let i = 0; i < SKILL_COPY_LIMITS.skillFiles + 5; i++) put(home, `.claude/skills/many/refs/${String(i).padStart(3, "0")}.md`, "ref\n");
    put(home, ".claude/skills/second/SKILL.md", skillMd("second"));
    put(home, ".claude/skills/second/guide.md", "y".repeat(2_000));
    const { machine } = machineFor(home);
    const total = SKILL_COPY_LIMITS.totalBytes;
    SKILL_COPY_LIMITS.totalBytes = SKILL_COPY_LIMITS.skillFiles * 4 + 100;
    try {
      const result = applySetupImport(machine, hostFor().host, { skills: true });
      expect(result.skills?.added).toEqual(["many", "second"]);
      expect(result.skills?.filesLeftOut).toBe(6);
      expect(filesUnder(join(IMPORTED_SKILLS_DIR, "many", "refs"))).toHaveLength(SKILL_COPY_LIMITS.skillFiles);
      expect(filesUnder(join(IMPORTED_SKILLS_DIR, "second"))).toEqual(["SKILL.md"]);
    } finally {
      SKILL_COPY_LIMITS.totalBytes = total;
    }
  });

  it("brings in a skill whose SKILL.md is spelled skill.md or Skill.md, and one file a disk ignoring case cannot hold stays out alone", () => {
    const home = fixtureHome();
    put(home, ".claude/skills/lower/skill.md", skillMd("lower"));
    put(home, ".claude/skills/lower/notes.md", "# Notes\n");
    put(home, ".claude/skills/mixed/Skill.md", skillMd("mixed"));
    put(home, ".claude/skills/pair/SKILL.md", skillMd("pair"));
    put(home, ".claude/skills/pair/README.md", "# Read me\n");
    const { machine } = machineFor(home);
    // A source that tells README.md from readme.md, as a Linux disk or a git checkout does.
    const pair = join(home, ".claude", "skills", "pair");
    const real = machine.fs;
    const twin = (path: string) => (path === join(pair, "readme.md") ? join(pair, "README.md") : path);
    machine.fs = {
      ...real,
      readdir: (path) => (path === pair ? ["README.md", "SKILL.md", "readme.md"] : real.readdir(path)),
      lstat: (path) => real.lstat(twin(path)),
      read: (path, max, follow) => real.read(twin(path), max, follow),
    };
    const caseBlind = existsSync(join(home, ".claude", "skills", "lower", "SKILL.md"));
    const caseBlindData = (() => {
      mkdirSync(IMPORTED_SKILLS_DIR, { recursive: true });
      writeFileSync(join(IMPORTED_SKILLS_DIR, "Probe"), "");
      const blind = existsSync(join(IMPORTED_SKILLS_DIR, "probe"));
      rmSync(join(IMPORTED_SKILLS_DIR, "Probe"));
      return blind;
    })();
    const result = applySetupImport(machine, hostFor().host, { skills: true });
    expect(result.skills?.added).toEqual(caseBlind ? ["lower", "mixed", "pair"] : ["pair"]);
    expect(result.skills?.filesLeftOut).toBe(caseBlindData ? 1 : 0);
    if (caseBlind) expect(filesUnder(join(IMPORTED_SKILLS_DIR, "lower"))).toEqual(["SKILL.md", "notes.md"]);
    expect(filesUnder(join(IMPORTED_SKILLS_DIR, "pair"))).toEqual(caseBlindData ? ["README.md", "SKILL.md"] : ["README.md", "SKILL.md", "readme.md"]);
  });
});

describe("bringing MCP servers in", () => {
  it("adds them switched off, the way Paste config does, keeping their keys on this computer and out of the answer", () => {
    const home = fixtureHome();
    plantTools(home);
    const { machine } = machineFor(home);
    const { host, servers, saves } = hostFor();
    const result = applySetupImport(machine, host, { tools: true });
    expect(result.tools).toEqual({
      added: ["github", "linear", "filesystem", "notion", "sentry", "figma", "context7", "legacy", "local-tool"],
      present: [],
      skipped: [],
    });
    expect(saves).toHaveLength(1);
    const saved = servers() as Record<string, Record<string, unknown>>;
    expect(Object.values(saved).map((server) => server.enabled)).toEqual(Array(9).fill(false));
    expect(saved.github).toEqual({ command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "ghp_secret_value" }, enabled: false });
    expect(saved.linear).toEqual({ type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer lin_secret_value" }, enabled: false });
    expect(saved.sentry).toMatchObject({ command: "npx", env: { SENTRY_TOKEN: "sntrys_secret_value" } });
    expect(saved.figma).toEqual({ type: "http", url: "https://mcp.figma.com/mcp", headers: {}, enabled: false });
    expect(saved.context7).toMatchObject({ type: "http", url: "https://mcp.context7.com/mcp" });
    expect(saved.legacy).toMatchObject({ type: "sse", url: "https://legacy.example.test/sse" });
    expect(saved["local-tool"]).toEqual({ command: "node", args: ["server.js", "8080"], env: {}, enabled: false });
    expect(JSON.stringify(result)).not.toMatch(/secret_value|Bearer/);
  });

  it("adds each server once, fills the list only to its limit, and leaves refused ones out", () => {
    const home = fixtureHome();
    plantTools(home);
    const { machine } = machineFor(home);
    const existing = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`s${i}`, { command: `tool-${i}`, args: [], env: {}, enabled: true }]));
    const { host, servers } = hostFor({ servers: { ...existing, notion: { type: "http", url: "https://MCP.notion.com/mcp", headers: {}, enabled: true } }, refuse: ["github"] });
    expect(applySetupImport(machine, host, { tools: true }).tools).toEqual({
      added: ["linear", "filesystem"],
      present: ["notion"],
      skipped: [
        { name: "sentry", reason: "limit" }, { name: "figma", reason: "limit" }, { name: "context7", reason: "limit" },
        { name: "legacy", reason: "limit" }, { name: "local-tool", reason: "limit" }, { name: "github", reason: "policy" },
      ],
    });
    expect(Object.keys(servers())).toHaveLength(20);
    expect((servers().notion as { enabled: boolean }).enabled).toBe(true);
    expect(applySetupImport(machine, host, { tools: true }).tools?.added).toEqual([]);
  });

  it("waits out another MCP change instead of interleaving with it", () => {
    const home = fixtureHome();
    plantTools(home);
    const { machine } = machineFor(home);
    const { host, saves, busy } = hostFor();
    busy.set(true);
    const result = applySetupImport(machine, host, { tools: true });
    expect(result.tools?.added).toEqual([]);
    expect(result.tools?.skipped.every((entry) => entry.reason === "busy")).toBe(true);
    expect(saves).toEqual([]);
  });
});
