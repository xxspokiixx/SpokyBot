// Writes the Digimon catalogue into shared/digimon-sprites.ts from the downloaded set.
import { readFileSync, writeFileSync } from "node:fs";

const index = JSON.parse(readFileSync("public/digimon/index.json", "utf8"));
const entries = index
  .map((entry) => `  { name: ${JSON.stringify(entry.name)}, level: ${JSON.stringify(entry.level)}, slug: ${JSON.stringify(entry.slug)} },`)
  .join("\n");

const file = "shared/digimon-sprites.ts";
const source = readFileSync(file, "utf8");
const next = source.replace(
  /export const DIGIMON_SPRITES: readonly DigimonSprite\[\] = \[\][\s\S]*?;/u,
  `export const DIGIMON_SPRITES: readonly DigimonSprite[] = [\n${entries}\n] as const;`,
);
writeFileSync(file, next);
console.log(`wrote ${index.length} digimon`);
