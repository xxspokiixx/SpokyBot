// Writes server/model-manifest/model-manifest.json from the drivers' own static lists, so the bundled copy can never name
// a model an engine here was not built to run. Run it after changing a driver's catalog:
//
//   node --experimental-strip-types scripts/generate-model-manifest.mjs
//
// The prices come from model-prices.ts, which is where this project keeps them.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "server", "model-manifest", "model-manifest.json");

/** Each engine's list as the driver declares it. A driver this build does not carry is left out of the manifest. */
async function engineSections() {
  const sections = {};
  const add = async (engine, load) => {
    try {
      const catalog = await load();
      if (!catalog?.options?.length) return;
      sections[engine] = {
        default: catalog.default,
        models: catalog.options.map((option) => ({
          id: option.id,
          name: option.label,
          status: "current",
          ...(option.contextWindow ? { contextWindow: option.contextWindow } : {}),
        })),
      };
    } catch (error) {
      console.warn(`[model-manifest] ${engine}: left out (${error instanceof Error ? error.message : String(error)})`);
    }
  };
  const claude = await import("../server/drivers/claude.ts");
  await add("claude", () => claude.STATIC_CLAUDE_MODELS);
  const codex = await import("../server/drivers/codex-catalog.ts");
  await add("codex", () => codex.STATIC_CODEX_MODELS);
  const grok = await import("../server/drivers/grok.ts");
  await add("grok", () => grok.STATIC_GROK_MODELS);
  return sections;
}

async function prices() {
  try {
    const { LIST_PRICES } = await import("../server/model-prices.ts");
    const out = {};
    for (const [model, price] of Object.entries(LIST_PRICES)) {
      if (!price || typeof price.inputPerMillion !== "number" || typeof price.outputPerMillion !== "number") continue;
      out[model] = {
        inputPerMillion: price.inputPerMillion,
        ...(typeof price.cachedInputPerMillion === "number" ? { cachedInputPerMillion: price.cachedInputPerMillion } : {}),
        outputPerMillion: price.outputPerMillion,
        asOf: price.asOf,
        source: price.source,
        ...(price.changes?.length ? { changes: price.changes } : {}),
      };
    }
    return Object.keys(out).length ? out : undefined;
  } catch (error) {
    console.warn(`[model-manifest] prices left out (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
}

const engines = await engineSections();
if (!engines.claude) {
  console.error("[model-manifest] claude is required; nothing was written.");
  process.exit(1);
}
const manifest = {
  version: 1,
  // The manifest's own date: a download older than the bundled copy loses, so this must move when a list changes.
  updatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  engines,
  ...(await prices()) ? { prices: await prices() } : {},
};
writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[model-manifest] wrote ${OUT}: ${Object.keys(engines).join(", ")}.`);
