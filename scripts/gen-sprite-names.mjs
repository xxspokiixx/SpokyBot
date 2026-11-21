// Writes the sprite filenames into NodeHostService so the extractor never depends on a folder listing.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const service = "android-test/app/src/main/kotlin/com/openmausbot/test/NodeHostService.kt";
const dir = "android-test/app/src/main/assets/omb/ui/pokemon";
const names = readdirSync(dir)
  .filter((name) => name.endsWith(".png"))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
const list = `        /** Assets.list() can answer empty for a folder this large, so the sprites are named instead. */\n        private val POKEMON_SPRITE_NAMES = arrayOf(${names.map((name) => `"${name}"`).join(", ")})`;

let text = readFileSync(service, "utf8");
const marker = /        private val POKEMON_SPRITE_NAMES = arrayOf\([^)]*\)/u;
text = marker.test(text) ? text.replace(marker, list) : text.replace("        private const val UI_DIR = \"ui\"", `        private const val UI_DIR = "ui"\n${list}`);
writeFileSync(service, text);
console.log(`wrote ${names.length} names`);
