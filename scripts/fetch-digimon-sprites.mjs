// Turns the Digimon API's illustrations into transparent 96px icons.
//
// The API has no sprite set — its pictures are 320px JPEGs on white — so each one is trimmed to
// its subject, made transparent and centred in the same square the Pokémon sprites use. They read
// as portraits beside those rather than as game sprites, which is what the source actually offers.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const out = new URL("../public/digimon/", import.meta.url);
mkdirSync(out, { recursive: true });

const catalogue = await (await fetch("https://digimon-api.vercel.app/api/digimon")).json();
// Rookie level holds the partners people know; the rest of the list is mostly evolutions.
const picked = catalogue.filter((entry) => /^(Rookie|In Training)$/i.test(entry.level));

let saved = 0;
for (const entry of picked) {
  const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  const file = new URL(`${slug}.png`, out);
  if (existsSync(file)) continue;
  const response = await fetch(entry.img);
  if (!response.ok) continue;
  const raw = new URL(`${slug}.jpg`, out);
  writeFileSync(raw, Buffer.from(await response.arrayBuffer()));
  try {
    execFileSync("magick", [
      raw.pathname.replace(/^\/([A-Za-z]:)/u, "$1"),
      "-fuzz", "10%", "-transparent", "white",
      "-trim", "+repage",
      "-resize", "96x96",
      "-gravity", "center", "-background", "none", "-extent", "96x96",
      file.pathname.replace(/^\/([A-Za-z]:)/u, "$1"),
    ]);
    saved += 1;
  } catch {
    // A picture that will not trim is left out; the rest of the set is still useful.
  }
}

const index = picked
  .filter((entry) => existsSync(new URL(`${entry.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "")}.png`, out)))
  .map((entry) => ({
    name: entry.name,
    level: entry.level,
    slug: entry.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, ""),
  }));
writeFileSync(new URL("index.json", out), `${JSON.stringify(index, null, 2)}\n`);
console.log(`saved ${saved}, indexed ${index.length}`);
