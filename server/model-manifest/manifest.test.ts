import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STATIC_CLAUDE_MODELS } from "../drivers/claude.ts";
import { STATIC_CODEX_MODELS } from "../drivers/codex-catalog.ts";
import { STATIC_GROK_MODELS } from "../drivers/grok.ts";
import { BUNDLED_MODEL_MANIFEST, engineCatalogFrom } from "./bundled.ts";
import { MANIFEST_DISABLE_ENV, MANIFEST_RETRY_MS, MANIFEST_TTL_MS, ModelManifestStore, modelManifestCachePath } from "./manifest.ts";
import { parseModelManifest } from "./schema.ts";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => { const dir = mkdtempSync(join(tmpdir(), "omb-manifest-")); dirs.push(dir); return dir; };

const manifest = (over: Record<string, unknown> = {}) => ({
  version: 1,
  updatedAt: "2026-11-18T00:00:00Z",
  engines: { claude: { default: "claude-sonnet-5", models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", status: "current" }] } },
  ...over,
});

describe("the bundled manifest", () => {
  it("names exactly the models this build's drivers can run, so a download can never invent one", () => {
    // scripts/generate-model-manifest.mjs writes this file from those lists; this is the check that it was run.
    for (const [engine, catalog] of [["claude", STATIC_CLAUDE_MODELS], ["codex", STATIC_CODEX_MODELS], ["grok", STATIC_GROK_MODELS]] as const) {
      const fromManifest = engineCatalogFrom(BUNDLED_MODEL_MANIFEST, engine);
      expect(fromManifest, `${engine} is in the manifest`).not.toBeNull();
      expect(fromManifest!.default, `${engine}'s default`).toBe(catalog.default);
      expect(fromManifest!.options.map((option) => option.id), `${engine}'s models`).toEqual(catalog.options.map((option) => option.id));
    }
  });

  it("validates as a strict manifest", () => {
    expect(parseModelManifest(BUNDLED_MODEL_MANIFEST, { strict: true, nowMs: NOW })).toMatchObject({ ok: true });
  });

  it("carries the prices this project keeps, each with its source and date", () => {
    const prices = BUNDLED_MODEL_MANIFEST.prices ?? {};
    expect(Object.keys(prices).length).toBeGreaterThan(10);
    for (const [model, price] of Object.entries(prices)) {
      expect(price.source, model).toMatch(/^https:\/\//);
      expect(price.asOf, model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("the manifest's schema", () => {
  it("refuses a default that is not a current model, a duplicate id, and a date in the future", () => {
    expect(parseModelManifest(manifest({ engines: { claude: { default: "claude-sonnet-5", models: [{ id: "claude-opus-5", name: "Opus", status: "current" }] } } }), { nowMs: NOW }).ok).toBe(false);
    expect(parseModelManifest(manifest({ engines: { claude: { default: "a", models: [{ id: "a", name: "A", status: "current" }, { id: "a", name: "A again", status: "current" }] } } }), { nowMs: NOW }).ok).toBe(false);
    expect(parseModelManifest(manifest({ updatedAt: "2099-01-01T00:00:00Z" }), { nowMs: NOW }).ok).toBe(false);
  });

  it("leaves unknown fields out of a download but rejects them in the bundled file", () => {
    const withExtra = manifest({ engines: { claude: { default: "claude-sonnet-5", models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", status: "current", surprise: true }] } } });
    const loose = parseModelManifest(withExtra, { nowMs: NOW });
    expect(loose.ok).toBe(true);
    expect(JSON.stringify(loose.ok && loose.manifest)).not.toContain("surprise");
    expect(parseModelManifest(withExtra, { strict: true, nowMs: NOW }).ok).toBe(false);
  });

  it("keeps a model id that could reach a command line to letters, digits and known separators", () => {
    const bad = manifest({ engines: { claude: { default: "claude-sonnet-5", models: [{ id: "claude; rm -rf /", name: "X", status: "current" }] } } });
    expect(parseModelManifest(bad, { nowMs: NOW }).ok).toBe(false);
  });
});

describe("the manifest store", () => {
  const store = (dir: string, fetchImpl?: typeof fetch, over: Partial<ConstructorParameters<typeof ModelManifestStore>[0]> = {}) =>
    new ModelManifestStore({ dataDir: dir, now: () => NOW, fetch: fetchImpl, log: () => {}, ...over });

  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  it("starts on the bundled copy and keeps it when the download fails", async () => {
    const dir = folder();
    const failing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const s = store(dir, failing);
    expect(s.current().updatedAt).toBe(BUNDLED_MODEL_MANIFEST.updatedAt);
    await s.refresh({ force: true });
    expect(s.current().updatedAt).toBe(BUNDLED_MODEL_MANIFEST.updatedAt);
  });

  it("takes a newer download, saves it, and reads it back on the next start", async () => {
    const dir = folder();
    const newer = manifest({ updatedAt: "2027-06-01T00:00:00Z", engines: { claude: { default: "claude-sonnet-5", models: [
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", status: "current" },
      { id: "claude-opus-6", name: "Claude Opus 6", status: "current" },
    ] } } });
    const s = store(dir, answer(newer), { now: () => Date.parse("2027-06-02T00:00:00Z") });
    await s.refresh({ force: true });
    expect(s.catalogFor("claude")!.options.map((option) => option.id)).toContain("claude-opus-6");
    // A fresh process, no network: the saved copy is what it starts on.
    const next = store(dir, (async () => { throw new Error("offline"); }) as unknown as typeof fetch, { now: () => Date.parse("2027-06-02T00:00:00Z") });
    expect(next.catalogFor("claude")!.options.map((option) => option.id)).toContain("claude-opus-6");
  });

  it("ignores a download older than what it already has, so a stale CDN cannot bring a retired model back", async () => {
    const dir = folder();
    const older = manifest({ updatedAt: "2020-01-01T00:00:00Z", engines: { claude: { default: "claude-sonnet-5", models: [{ id: "claude-sonnet-5", name: "Old", status: "current" }] } } });
    const s = store(dir, answer(older));
    await s.refresh({ force: true });
    expect(s.current().updatedAt).toBe(BUNDLED_MODEL_MANIFEST.updatedAt);
  });

  it("shares one request between callers and backs off after a failure", async () => {
    const dir = folder();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    const s = store(dir, fetchImpl as unknown as typeof fetch);
    await Promise.all([s.refresh({ force: true }), s.refresh({ force: true })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await s.refresh();
    expect(fetchImpl, "inside the retry window").toHaveBeenCalledTimes(1);
    expect(MANIFEST_RETRY_MS).toBeLessThan(MANIFEST_TTL_MS);
  });

  it("stops fetching when the environment says so, and reports no price for a model it does not list", async () => {
    const dir = folder();
    const fetchImpl = vi.fn();
    const s = store(dir, fetchImpl as unknown as typeof fetch, { env: { [MANIFEST_DISABLE_ENV]: "1" } });
    await s.refresh({ force: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(s.priceFor("a-model-that-is-not-listed")).toBeNull();
  });

  it("refuses a download that is not the manifest, and one too large", async () => {
    const dir = folder();
    const bad = store(dir, answer({ hello: "world" }));
    await bad.refresh({ force: true });
    expect(bad.current().updatedAt).toBe(BUNDLED_MODEL_MANIFEST.updatedAt);
    const huge = store(dir, (async () => new Response("{}", { status: 200, headers: { "content-length": String(10 * 1024 * 1024) } })) as unknown as typeof fetch);
    await huge.refresh({ force: true });
    expect(huge.current().updatedAt).toBe(BUNDLED_MODEL_MANIFEST.updatedAt);
  });

  it("keeps its cache under providers/, where a backup leaves it out", () => {
    expect(modelManifestCachePath("/data")).toBe(join("/data", "providers", "model-manifest", "model-manifest.json"));
  });
});
