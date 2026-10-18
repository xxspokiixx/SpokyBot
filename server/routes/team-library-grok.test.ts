import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope } from "../request-auth.ts";
import { dispatchRoutes } from "./table.ts";
import { createTeamRoutes, type TeamRouteDeps } from "./teams.ts";

const ID = "d8OshqLZvtcKDcNluPuyo";
const page = readFileSync(join(import.meta.dirname, "..", "fixtures", "grok-share-page.html"), "utf8");
const realFetch = globalThis.fetch;
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve() {
  // The Grok route reads none of the team dependencies.
  const routes = [createTeamRoutes({ routines: () => null, orgLibrary: () => null } as unknown as TeamRouteDeps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody });
    if (!handled) json(res, 404, { error: "not routed" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (body: unknown) => realFetch(`${base}/api/team-library/grok`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/team-library/grok", () => {
  it("is an admin route, like the GitHub import", () => {
    expect(requiredScope("POST", "/api/team-library/grok")).toBe("admin");
    expect(requiredScope("POST", "/api/team-library/github")).toBe("admin");
  });

  it("answers the public card for a share link", async () => {
    const upstream = vi.fn(async () => new Response(page, { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", upstream);
    const post = await serve();
    const response = await post({ url: `https://x.ai/bot/${ID}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ shareId: ID, name: "DOGE (Department of Grok Efficiency)", creator: "Avid", url: `https://x.ai/bot/${ID}` });
    expect(upstream).toHaveBeenCalledExactlyOnceWith(`https://x.ai/bot/${ID}`, expect.objectContaining({ redirect: "manual" }));
  });

  it("refuses a missing or foreign link without fetching, and passes on a missing bot", async () => {
    const upstream = vi.fn(async () => new Response("gone", { status: 404 }));
    vi.stubGlobal("fetch", upstream);
    const post = await serve();
    expect((await post({})).status).toBe(400);
    const foreign = await post({ url: `https://evil.example/bot/${ID}` });
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { error: string }).error).toMatch(/Grok Bot share link/);
    expect(upstream).not.toHaveBeenCalled();
    expect((await post({ url: `https://x.ai/bot/${ID}` })).status).toBe(404);
  });
});
