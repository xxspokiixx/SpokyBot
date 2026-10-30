import { describe, expect, it } from "vitest";
import { registerPlugin, searchCatalog, installPlugin, uninstallPlugin, getMcpServerStatus, authenticateMcpServer, addMcpServer, removeMcpAccount, renameMcpAccount, setMcpInstructions, restartMcpServers, uninstallMcpServer } from "./plugins-catalog.ts";

const plugin = {
  id: "demo",
  name: "Demo",
  description: "demo plugin",
  category: "Productivity",
  connectors: [{ name: "demo", transport: "http" as const, url: "https://example.com/mcp", auth: "none" as const }],
  skills: [{ name: "skill1", description: "use when demo", body: "body" }],
  setupFields: [{ key: "KEY", label: "Key", required: true, secret: false }],
  source: "marketplace" as const,
};

describe("plugins catalog", () => {
  it("searches and installs", () => {
    registerPlugin(plugin);
    const results = searchCatalog("u1", "demo");
    expect(results.length).toBe(1);
    expect(results[0].installed).toBe(false);
    const bad = installPlugin("u1", "demo", {});
    expect(bad.ok).toBe(false);
    const ok = installPlugin("u1", "demo", { KEY: "v" });
    expect(ok.ok).toBe(true);
    expect(getMcpServerStatus().length).toBe(1);
    expect(searchCatalog("u1", "demo")[0].installed).toBe(true);
  });
  it("uninstalls fully", () => {
    const r = uninstallPlugin("u1", "demo");
    expect(r.ok).toBe(true);
    expect(getMcpServerStatus().length).toBe(0);
  });
  it("custom server + account ops", () => {
    const a = addMcpServer({ name: "custom", url: "https://x/mcp" });
    expect(a.ok).toBe(true);
    const sid = a.serverId!;
    expect(authenticateMcpServer(sid, "work").ok).toBe(true);
    expect(removeMcpAccount(sid, "default").ok).toBe(true);
    expect(renameMcpAccount(sid, "work", "renamed").ok).toBe(true);
    expect(setMcpInstructions(sid, "do x").ok).toBe(true);
    expect(restartMcpServers().ok).toBe(true);
    expect(uninstallMcpServer(sid).ok).toBe(true);
  });
});
