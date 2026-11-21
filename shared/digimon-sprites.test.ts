// Every Digimon the picker offers has a picture behind it, and every picture is a real PNG.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DIGIMON_SPRITES } from "./digimon-sprites.ts";

const root = join(import.meta.dirname, "..", "public", "digimon");

describe("the Digimon the picker offers", () => {
  it("names each one once, with a level and a slug", () => {
    expect(DIGIMON_SPRITES.length).toBeGreaterThan(0);
    const slugs = DIGIMON_SPRITES.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of DIGIMON_SPRITES) {
      expect(entry.name.trim(), entry.slug).not.toBe("");
      expect(entry.slug, entry.name).toMatch(/^[a-z0-9-]+$/u);
    }
  });

  it("has a picture on disk for every one, so no tap lands on a broken image", () => {
    for (const entry of DIGIMON_SPRITES) {
      const file = join(root, `${entry.slug}.png`);
      expect(existsSync(file), entry.slug).toBe(true);
      // A PNG, not the JPEG the catalogue serves: the icons are trimmed and made transparent.
      expect(readFileSync(file).subarray(1, 4).toString(), entry.slug).toBe("PNG");
    }
  });
});
