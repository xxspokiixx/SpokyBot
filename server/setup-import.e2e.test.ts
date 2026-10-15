import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

// The fixture server's HOME is its own disposable data folder, so the files planted here are the only ones it can find.
const SENTINEL = "SENTINEL-e2e-credential-51c0";

describe("bringing in another AI tool's setup through the real server", () => {
  let fixture: VerificationServer;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, text: await response.text() };
  };
  const put = (path: string, text: string) => {
    const full = join(fixture.info.dataDir, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  };

  beforeAll(async () => {
    fixture = await launchVerificationServer();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it("finds a skill and an MCP server, copies the skill into the bot switched on, and adds the server switched off", async () => {
    put(".claude/skills/release-notes/SKILL.md", "---\nname: release-notes\ndescription: Writes release notes from merged changes.\n---\n\nRun scripts/collect.sh first.\n");
    put(".claude/skills/release-notes/scripts/collect.sh", "git log --oneline\n");
    put(".claude.json", JSON.stringify({
      oauthAccount: { accessToken: SENTINEL },
      mcpServers: { github: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "ghp_e2e_secret" } } },
    }));
    put(".codex/auth.json", SENTINEL);
    put(".claude/.credentials.json", SENTINEL);

    const found = await api("GET", "/api/setup-import");
    expect(found.status).toBe(200);
    expect(JSON.parse(found.text)).toEqual({
      skills: [{ name: "release-notes", source: "claudeCode" }],
      tools: [{ name: "github", source: "claudeCode" }],
    });

    const brought = await api("POST", "/api/setup-import", { skills: true, tools: true });
    expect(brought.status).toBe(200);
    expect(JSON.parse(brought.text)).toEqual({
      skills: { added: ["release-notes"], present: [], skipped: [], filesLeftOut: 0 },
      tools: { added: ["github"], present: [], skipped: [] },
    });

    const bots = JSON.parse((await api("GET", "/api/bots")).text) as { bots: Array<{ id: string }> };
    const skills = await api("GET", `/api/bots/${bots.bots[0]!.id}/skills`);
    expect(JSON.parse(skills.text).skills).toEqual([
      expect.objectContaining({ name: "release-notes", enabled: true, source: "~/.claude/skills/release-notes" }),
    ]);
    const mcp = await api("GET", "/api/mcp/servers");
    expect(JSON.parse(mcp.text).servers).toEqual([
      expect.objectContaining({ name: "github", command: "npx", envKeys: ["GITHUB_TOKEN"], enabled: false }),
    ]);

    expect(JSON.parse((await api("GET", "/api/setup-import")).text)).toEqual({ skills: [], tools: [] });
    for (const said of [found.text, brought.text, skills.text, mcp.text]) {
      expect(said).not.toContain(SENTINEL);
      expect(said).not.toContain("ghp_e2e_secret");
    }
  });
});
