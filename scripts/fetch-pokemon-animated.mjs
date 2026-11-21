// Downloads the 151 animated sprites (Black/White, 96px) beside the still ones.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const target = new URL("../public/pokemon/animated/", import.meta.url);
mkdirSync(target, { recursive: true });

let saved = 0;
let skipped = 0;
const missing = [];
for (let number = 1; number <= 151; number += 1) {
  const file = new URL(`${number}.gif`, target);
  if (existsSync(file)) { skipped += 1; continue; }
  const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${number}.gif`;
  const response = await fetch(url);
  if (!response.ok) { missing.push(number); continue; }
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  saved += 1;
  if (saved % 40 === 0) console.log(`${saved} downloaded`);
}
console.log(`done: ${saved} downloaded, ${skipped} present, missing ${missing.length}${missing.length ? ` (${missing.slice(0, 8).join(", ")})` : ""}`);
