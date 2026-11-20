// The bundled manifest, importable before anything else in the server. It carries the same model ids the drivers build
// their static lists from, so a download can only ever add or retire a model, never invent one the engines cannot run.
//
// This file is a copy, not the source: the drivers' own lists stay authoritative for what an engine accepts today, and
// this is what a server with no network starts on. When a driver's list changes, regenerate it with
// `node scripts/generate-model-manifest.mjs` (server/model-manifest/manifest.test.ts fails when they drift apart).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelCatalog } from "../contracts.ts";
import { parseModelManifest, type ManifestEngine, type ModelManifestData } from "./schema.ts";

export const BUNDLED_MANIFEST_PATH = join(import.meta.dirname, "model-manifest.json");

/** What a build with no manifest file starts on: the one engine every install has, and one model it accepts. */
const EMPTY_MANIFEST: ModelManifestData = {
  version: 1,
  updatedAt: "2026-01-01T00:00:00Z",
  engines: { claude: { default: "claude-sonnet-5", models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", status: "current" }] } },
};

/** Read rather than imported as JSON: a build that ships no manifest file still starts, on the drivers' own lists. */
function loadBundled(): ModelManifestData {
  if (!existsSync(BUNDLED_MANIFEST_PATH)) return EMPTY_MANIFEST;
  try {
    // The bundle's own date may be in the future on a clock that is behind: the tolerance is the whole point of `nowMs`.
    const parsed = parseModelManifest(JSON.parse(readFileSync(BUNDLED_MANIFEST_PATH, "utf8")), { strict: true, nowMs: Number.MAX_SAFE_INTEGER / 2 });
    return parsed.ok ? parsed.manifest : EMPTY_MANIFEST;
  } catch {
    return EMPTY_MANIFEST;
  }
}

export const BUNDLED_MODEL_MANIFEST: ModelManifestData = loadBundled();

/** The manifest's engine as the picker wants it; legacy models stay valid in a saved bot but are not offered for new picks. */
export function engineCatalogFrom(manifest: ModelManifestData, engine: ManifestEngine): ModelCatalog | null {
  const section = manifest.engines[engine];
  if (!section) return null;
  return {
    default: section.default,
    options: section.models.filter((model) => model.status === "current").map((model) => ({
      id: model.id,
      label: model.name,
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model.variants?.length ? { variants: model.variants } : {}),
    })),
  };
}

export function bundledEngineCatalog(engine: ManifestEngine): ModelCatalog | null {
  return engineCatalogFrom(BUNDLED_MODEL_MANIFEST, engine);
}
