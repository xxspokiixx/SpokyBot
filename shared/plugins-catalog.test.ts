import { describe, expect, it } from "vitest";
import { searchPlugins } from "../shared/plugins-catalog.ts";

const plugins = [
  { id: "a", name: "Linear", description: "linear issues", category: "Productivity", connectors: [], skills: [], setupFields: [], source: "marketplace" as const },
  { id: "b", name: "Slack", description: "chat", category: "MCP", connectors: [{ name: "s", transport: "http" as const }], skills: [{ name: "sk", description: "when", body: "b" }], setupFields: [], source: "marketplace" as const },
];

describe("shared plugins catalog", () => {
  it("ranks search results", () => {
    const r = searchPlugins(plugins as any, "linear issues", new Set());
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("a");
  });
  it("marks installed", () => {
    const r = searchPlugins(plugins as any, "", new Set(["b"]));
    const b = r.find((x) => x.id === "b");
    expect(b?.installed).toBe(true);
    expect(b?.connectorCount).toBe(1);
    expect(b?.skillCount).toBe(1);
  });
  it("omitted query lists all", () => {
    const r = searchPlugins(plugins as any, undefined, new Set());
    expect(r.length).toBe(2);
  });
});
