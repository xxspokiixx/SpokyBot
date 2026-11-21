// Downloads the 151 first-generation sprites into public/pokemon, keeping them small and uniform.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const target = new URL("../public/pokemon/", import.meta.url);
mkdirSync(target, { recursive: true });

let saved = 0;
let skipped = 0;
for (let number = 1; number <= 151; number += 1) {
  const file = new URL(`${number}.png`, target);
  if (existsSync(file)) { skipped += 1; continue; }
  const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${number}.png`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${number}: ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  saved += 1;
  if (saved % 25 === 0) console.log(`${saved} downloaded`);
}
console.log(`done: ${saved} downloaded, ${skipped} already there`);
