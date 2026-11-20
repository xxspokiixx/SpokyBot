/**
 * The Pokémon bodies a bot can wear: the first 151, drawn as simple flat shapes in the mascot's own
 * 240-unit square (see halloween-bodies.ts for the same contract).
 *
 * GENERATED FILE — do not hand-edit. Run `pnpm gen:pokemon` to rebuild it from
 * `scripts/gen-pokemon-bodies.ts`.
 *
 * These are flat interpretations — a colour, a silhouette and the couple of marks that make the
 * creature recognisable — not copies of any original artwork. Every one carries the same face, so
 * the mascot still reads as one character wearing a costume.
 *
 * `paint: "bot"` keeps the bot's own colour chosen in the picker; "species" pins the creature's
 * signature colour so the body is recognisable at 40px.
 */
export interface PokemonBody {
  id: string;
  /** The National Pokédex number, which is also the order the picker shows them in. */
  number: number;
  name: string;
  /** "bot" follows the bot's colour; "species" keeps `color`, so the creature reads at a glance. */
  paint: "bot" | "species";
  color: string;
  /** A second colour for the marking, when the drawing needs one. */
  accent?: string;
  /** Draw order, bottom first. `body` is the paint, `accent` the second colour, or a literal. */
  parts: ReadonlyArray<{ fill: string; d: string }>;
  /** Where the face sits and how big it is, in the same units as HalloweenEyes. */
  eyes: { cx: number; cy: number; dx: number; w: number; h: number; round: number; ink: string; mouth: boolean; mouthInk: string; mouthY: number | null };
  /** Where the eyes may show. */
  clip: string;
}

export const POKEMON_BODY_IDS = [
  "bulbasaur", "ivysaur", "venusaur", "charmander", "charmeleon", "charizard", "squirtle", "wartortle", "blastoise",
  "caterpie", "metapod", "butterfree", "weedle", "kakuna", "beedrill", "pidgey", "pidgeotto", "pidgeot", "rattata",
  "raticate", "spearow", "fearow", "ekans", "arbok", "pikachu", "raichu", "sandshrew", "sandslash", "nidoran-f",
  "nidorina", "nidoqueen", "nidoran-m", "nidorino", "nidoking", "clefairy", "clefable", "vulpix", "ninetales",
  "jigglypuff", "wigglytuff", "zubat", "golbat", "oddish", "gloom", "vileplume", "paras", "parasect", "venonat",
  "venomoth", "diglett", "dugtrio", "meowth", "persian", "psyduck", "golduck", "mankey", "primeape", "growlithe",
  "arcanine", "poliwag", "poliwhirl", "poliwrath", "abra", "kadabra", "alakazam", "machop", "machoke", "machamp",
  "bellsprout", "weepinbell", "victreebel", "tentacool", "tentacruel", "geodude", "graveler", "golem", "ponyta",
  "rapidash", "slowpoke", "slowbro", "magnemite", "magneton", "farfetchd", "doduo", "dodrio", "seel", "dewgong",
  "grimer", "muk", "shellder", "cloyster", "gastly", "haunter", "gengar", "onix", "drowzee", "hypno", "krabby",
  "kingler", "voltorb", "electrode", "exeggcute", "exeggutor", "cubone", "marowak", "hitmonlee", "hitmonchan",
  "lickitung", "koffing", "weezing", "rhyhorn", "rhydon", "chansey", "tangela", "kangaskhan", "horsea", "seadra",
  "goldeen", "seaking", "staryu", "starmie", "mr-mime", "scyther", "jynx", "electabuzz", "magmar", "pinsir",
  "tauros", "magikarp", "gyarados", "lapras", "ditto", "eevee", "vaporeon", "jolteon", "flareon", "porygon",
  "omanyte", "omastar", "kabuto", "kabutops", "aerodactyl", "snorlax", "articuno", "zapdos", "moltres", "dratini",
  "dragonair", "dragonite", "mewtwo", "mew",
] as const;

export type PokemonBodyId = (typeof POKEMON_BODY_IDS)[number];

/** A round body with a small head bump: the shape most of the first generation shares. */
function blob(cx: number, top: number, wide: number, tall: number): string {
  const r = wide / 2;
  const bottom = top + tall;
  return `M${cx - r} ${bottom - r} C${cx - r} ${bottom} ${cx + r} ${bottom} ${cx + r} ${bottom - r} ` +
    `L${cx + r} ${top + r} C${cx + r} ${top} ${cx - r} ${top} ${cx - r} ${top + r} Z`;
}

function round(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
}

/** A triangle, for ears, beaks and fins. */
function tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): string {
  return `M${ax} ${ay} L${bx} ${by} L${cx} ${cy} Z`;
}

const INK = "#0d0a10";
const eyes = (cx: number, cy: number, dx = 30, w = 22, h = 34, round = 34) =>
  ({ cx, cy, dx, w, h, round, ink: INK, mouth: true, mouthInk: INK, mouthY: null });

/** A body of one colour with the face on it. */
const plain = (id: string, number: number, name: string, color: string, shape: string, eye = eyes(120, 150)): PokemonBody => ({
  id, number, name, paint: "species", color, parts: [{ fill: "body", d: shape }], eyes: eye, clip: shape,
});

export const POKEMON_BODIES: Record<PokemonBodyId, PokemonBody> = {
  bulbasaur: {
    id: "bulbasaur", number: 1, name: "Bulbasaur", paint: "species", color: "#7ac74c", accent: "#3f7a2e",
    parts: [
      { fill: "accent", d: ellipse(120, 84, 46, 34) },
      { fill: "body", d: blob(120, 92, 132, 122) },
      { fill: "accent", d: ellipse(120, 74, 20, 26) },
    ],
    eyes: eyes(120, 148, 32, 22, 34), clip: blob(120, 92, 132, 122),
  },
  ivysaur: {
    id: "ivysaur", number: 2, name: "Ivysaur", paint: "species", color: "#6fbf5a", accent: "#f15a8c",
    parts: [
      { fill: "accent", d: ellipse(120, 76, 52, 38) },
      { fill: "body", d: blob(120, 96, 136, 118) },
      { fill: "accent", d: ellipse(120, 66, 24, 22) },
    ],
    eyes: eyes(120, 150, 32, 22, 32), clip: blob(120, 96, 136, 118),
  },
  venusaur: {
    id: "venusaur", number: 3, name: "Venusaur", paint: "species", color: "#63b04f", accent: "#e8608f",
    parts: [
      { fill: "accent", d: ellipse(120, 70, 62, 40) },
      { fill: "body", d: blob(120, 100, 148, 116) },
      { fill: "accent", d: ellipse(120, 58, 30, 24) },
    ],
    eyes: eyes(120, 156, 34, 22, 30), clip: blob(120, 100, 148, 116),
  },
  charmander: {
    id: "charmander", number: 4, name: "Charmander", paint: "species", color: "#f0883e", accent: "#ffd166",
    parts: [
      { fill: "accent", d: `M162 196 C196 186 206 156 196 132 C214 158 210 196 182 210 C170 214 158 210 154 202 Z` },
      { fill: "body", d: blob(120, 96, 128, 118) },
    ],
    eyes: eyes(120, 150, 32, 22, 34), clip: blob(120, 96, 128, 118),
  },
  charmeleon: {
    id: "charmeleon", number: 5, name: "Charmeleon", paint: "species", color: "#e2683c", accent: "#ffcf5c",
    parts: [
      { fill: "accent", d: `M164 200 C200 190 210 158 200 134 C218 160 214 200 184 214 C172 218 160 212 156 204 Z` },
      { fill: "body", d: blob(120, 90, 132, 124) },
    ],
    eyes: eyes(120, 146, 32, 22, 32), clip: blob(120, 90, 132, 124),
  },
  charizard: {
    id: "charizard", number: 6, name: "Charizard", paint: "species", color: "#ef7f3a", accent: "#5aa9c9",
    parts: [
      { fill: "accent", d: `M120 150 L34 96 L44 152 L22 190 L96 178 Z` },
      { fill: "accent", d: `M120 150 L206 96 L196 152 L218 190 L144 178 Z` },
      { fill: "accent", d: `M154 206 C198 200 208 164 198 138 C216 166 210 210 176 222 C164 224 156 218 152 210 Z` },
      { fill: "body", d: blob(120, 86, 128, 128) },
    ],
    eyes: eyes(120, 144, 30, 22, 30), clip: blob(120, 86, 128, 128),
  },
  squirtle: plain("squirtle", 7, "Squirtle", "#6ec5e9", blob(120, 94, 130, 120)),
  wartortle: plain("wartortle", 8, "Wartortle", "#5fa8d8", blob(120, 90, 134, 124)),
  blastoise: plain("blastoise", 9, "Blastoise", "#4f8fc0", blob(120, 92, 140, 122)),
  caterpie: plain("caterpie", 10, "Caterpie", "#8fce4f", blob(120, 106, 116, 108)),
  metapod: plain("metapod", 11, "Metapod", "#7fb84a", ellipse(120, 152, 62, 78)),
  butterfree: plain("butterfree", 12, "Butterfree", "#7fb2e5", blob(120, 88, 124, 126)),
  weedle: plain("weedle", 13, "Weedle", "#c8a24a", blob(120, 104, 108, 110)),
  kakuna: plain("kakuna", 14, "Kakuna", "#c8b44e", ellipse(120, 152, 54, 74)),
  beedrill: plain("beedrill", 15, "Beedrill", "#e0c341", blob(120, 90, 126, 124)),
  pidgey: plain("pidgey", 16, "Pidgey", "#cbb28a", blob(120, 100, 122, 114)),
  pidgeotto: plain("pidgeotto", 17, "Pidgeotto", "#c39b6b", blob(120, 96, 128, 118)),
  pidgeot: plain("pidgeot", 18, "Pidgeot", "#b98a5c", blob(120, 92, 134, 122)),
  rattata: plain("rattata", 19, "Rattata", "#a98bc4", blob(120, 102, 118, 112)),
  raticate: plain("raticate", 20, "Raticate", "#a07ab8", blob(120, 98, 126, 116)),
  spearow: plain("spearow", 21, "Spearow", "#b08154", blob(120, 100, 118, 114)),
  fearow: plain("fearow", 22, "Fearow", "#a3714a", blob(120, 96, 126, 118)),
  ekans: plain("ekans", 23, "Ekans", "#a86fc4", blob(120, 104, 112, 110)),
  arbok: plain("arbok", 24, "Arbok", "#8f5aa8", blob(120, 96, 124, 118)),
  pikachu: {
    id: "pikachu", number: 25, name: "Pikachu", paint: "species", color: "#f5d33f", accent: "#3a2f22",
    parts: [
      { fill: "accent", d: tri(86, 96, 64, 40, 102, 82) },
      { fill: "accent", d: tri(154, 96, 176, 40, 138, 82) },
      { fill: "body", d: blob(120, 96, 128, 118) },
      { fill: "accent", d: ellipse(120, 172, 16, 12) },
    ],
    eyes: eyes(120, 148, 32, 22, 34), clip: blob(120, 96, 128, 118),
  },
  raichu: {
    id: "raichu", number: 26, name: "Raichu", paint: "species", color: "#f0a23e", accent: "#3a2f22",
    parts: [
      { fill: "accent", d: tri(88, 98, 70, 46, 104, 86) },
      { fill: "accent", d: tri(152, 98, 170, 46, 136, 86) },
      { fill: "body", d: blob(120, 94, 132, 122) },
    ],
    eyes: eyes(120, 146, 32, 22, 32), clip: blob(120, 94, 132, 122),
  },
  sandshrew: plain("sandshrew", 27, "Sandshrew", "#e0c073", blob(120, 102, 122, 114)),
  sandslash: plain("sandslash", 28, "Sandslash", "#cfa75c", blob(120, 98, 128, 118)),
  "nidoran-f": plain("nidoran-f", 29, "Nidoran♀", "#a8c8e8", blob(120, 100, 120, 114)),
  nidorina: plain("nidorina", 30, "Nidorina", "#94bce0", blob(120, 98, 124, 116)),
  nidoqueen: plain("nidoqueen", 31, "Nidoqueen", "#7aa8d4", blob(120, 94, 130, 120)),
  "nidoran-m": plain("nidoran-m", 32, "Nidoran♂", "#b48fd0", blob(120, 100, 120, 114)),
  nidorino: plain("nidorino", 33, "Nidorino", "#a07ac0", blob(120, 98, 124, 116)),
  nidoking: plain("nidoking", 34, "Nidoking", "#8c66ad", blob(120, 94, 130, 120)),
  clefairy: plain("clefairy", 35, "Clefairy", "#f2c6d4", blob(120, 100, 122, 114)),
  clefable: plain("clefable", 36, "Clefable", "#efb6c8", blob(120, 96, 128, 118)),
  vulpix: plain("vulpix", 37, "Vulpix", "#e8813e", blob(120, 102, 120, 112)),
  ninetales: plain("ninetales", 38, "Ninetales", "#e0a24f", blob(120, 96, 128, 118)),
  jigglypuff: plain("jigglypuff", 39, "Jigglypuff", "#f2b6cf", round(120, 152, 74)),
  wigglytuff: plain("wigglytuff", 40, "Wigglytuff", "#f0a5c4", round(120, 148, 80)),
  zubat: plain("zubat", 41, "Zubat", "#7a86c8", blob(120, 100, 124, 112)),
  golbat: plain("golbat", 42, "Golbat", "#6b78bd", blob(120, 96, 130, 118)),
  oddish: plain("oddish", 43, "Oddish", "#6fb04f", round(120, 154, 72)),
  gloom: plain("gloom", 44, "Gloom", "#5f9e46", round(120, 152, 76)),
  vileplume: plain("vileplume", 45, "Vileplume", "#d05a6e", round(120, 150, 80)),
  paras: plain("paras", 46, "Paras", "#e28a4f", blob(120, 104, 118, 110)),
  parasect: plain("parasect", 47, "Parasect", "#cf7a42", blob(120, 98, 124, 116)),
  venonat: plain("venonat", 48, "Venonat", "#b08acb", round(120, 152, 72)),
  venomoth: plain("venomoth", 49, "Venomoth", "#a479bd", blob(120, 98, 126, 116)),
  diglett: plain("diglett", 50, "Diglett", "#c08a5a", ellipse(120, 176, 52, 62)),
  dugtrio: plain("dugtrio", 51, "Dugtrio", "#b07a4c", ellipse(120, 178, 72, 58)),
  meowth: plain("meowth", 52, "Meowth", "#f0dfa8", blob(120, 100, 122, 114)),
  persian: plain("persian", 53, "Persian", "#efd79a", blob(120, 96, 128, 118)),
  psyduck: plain("psyduck", 54, "Psyduck", "#f0c85a", blob(120, 100, 124, 114)),
  golduck: plain("golduck", 55, "Golduck", "#5aa0cc", blob(120, 96, 130, 118)),
  mankey: plain("mankey", 56, "Mankey", "#e8d0b0", blob(120, 102, 118, 112)),
  primeape: plain("primeape", 57, "Primeape", "#ddc29e", blob(120, 98, 126, 116)),
  growlithe: plain("growlithe", 58, "Growlithe", "#e8894a", blob(120, 102, 122, 112)),
  arcanine: plain("arcanine", 59, "Arcanine", "#e2733a", blob(120, 94, 132, 120)),
  poliwag: plain("poliwag", 60, "Poliwag", "#6fb8e0", round(120, 154, 70)),
  poliwhirl: plain("poliwhirl", 61, "Poliwhirl", "#5aa8d6", round(120, 150, 76)),
  poliwrath: plain("poliwrath", 62, "Poliwrath", "#4288c0", blob(120, 96, 128, 118)),
  abra: plain("abra", 63, "Abra", "#e6c46a", blob(120, 102, 120, 112)),
  kadabra: plain("kadabra", 64, "Kadabra", "#dcb552", blob(120, 98, 126, 116)),
  alakazam: plain("alakazam", 65, "Alakazam", "#d0a83e", blob(120, 96, 128, 118)),
  machop: plain("machop", 66, "Machop", "#a8b8c8", blob(120, 100, 122, 114)),
  machoke: plain("machoke", 67, "Machoke", "#96a8bc", blob(120, 96, 128, 118)),
  machamp: plain("machamp", 68, "Machamp", "#8c9fb4", blob(120, 94, 130, 120)),
  bellsprout: plain("bellsprout", 69, "Bellsprout", "#e0c85a", blob(120, 104, 116, 110)),
  weepinbell: plain("weepinbell", 70, "Weepinbell", "#d4bc48", blob(120, 100, 122, 114)),
  victreebel: plain("victreebel", 71, "Victreebel", "#c4a83e", blob(120, 96, 128, 118)),
  tentacool: plain("tentacool", 72, "Tentacool", "#5aa8cc", blob(120, 100, 120, 114)),
  tentacruel: plain("tentacruel", 73, "Tentacruel", "#4a90b8", blob(120, 96, 128, 118)),
  geodude: plain("geodude", 74, "Geodude", "#9a94a0", blob(120, 100, 124, 114)),
  graveler: plain("graveler", 75, "Graveler", "#8b8593", blob(120, 96, 130, 118)),
  golem: plain("golem", 76, "Golem", "#7c7686", blob(120, 92, 134, 122)),
  ponyta: plain("ponyta", 77, "Ponyta", "#f0e8d8", blob(120, 100, 122, 114)),
  rapidash: plain("rapidash", 78, "Rapidash", "#ece0cc", blob(120, 96, 128, 118)),
  slowpoke: plain("slowpoke", 79, "Slowpoke", "#f0b6c0", blob(120, 102, 124, 112)),
  slowbro: plain("slowbro", 80, "Slowbro", "#e8a6b2", blob(120, 98, 130, 116)),
  magnemite: plain("magnemite", 81, "Magnemite", "#b8bcc8", round(120, 150, 68)),
  magneton: plain("magneton", 82, "Magneton", "#a8adbc", round(120, 148, 76)),
  farfetchd: plain("farfetchd", 83, "Farfetch'd", "#d4a45a", blob(120, 100, 122, 114)),
  doduo: plain("doduo", 84, "Doduo", "#d0a878", blob(120, 100, 120, 114)),
  dodrio: plain("dodrio", 85, "Dodrio", "#c49a6b", blob(120, 96, 128, 118)),
  seel: plain("seel", 86, "Seel", "#e8e4f0", blob(120, 102, 124, 112)),
  dewgong: plain("dewgong", 87, "Dewgong", "#e2dcea", blob(120, 98, 130, 116)),
  grimer: plain("grimer", 88, "Grimer", "#a47ac8", ellipse(120, 158, 68, 66)),
  muk: plain("muk", 89, "Muk", "#9470b8", ellipse(120, 152, 78, 74)),
  shellder: plain("shellder", 90, "Shellder", "#9c7ac0", round(120, 152, 70)),
  cloyster: plain("cloyster", 91, "Cloyster", "#8c6ab0", round(120, 150, 76)),
  gastly: plain("gastly", 92, "Gastly", "#6a5a88", round(120, 150, 72)),
  haunter: plain("haunter", 93, "Haunter", "#7a5a98", round(120, 148, 76)),
  gengar: plain("gengar", 94, "Gengar", "#7a5aa8", round(120, 148, 78)),
  onix: plain("onix", 95, "Onix", "#a8a0a8", ellipse(120, 150, 56, 84)),
  drowzee: plain("drowzee", 96, "Drowzee", "#e0b88c", blob(120, 100, 124, 114)),
  hypno: plain("hypno", 97, "Hypno", "#d4a878", blob(120, 96, 130, 118)),
  krabby: plain("krabby", 98, "Krabby", "#e08a5a", blob(120, 102, 122, 112)),
  kingler: plain("kingler", 99, "Kingler", "#d0744a", blob(120, 96, 130, 118)),
  voltorb: plain("voltorb", 100, "Voltorb", "#e05858", round(120, 152, 72)),
  electrode: plain("electrode", 101, "Electrode", "#d84a4a", round(120, 150, 78)),
  exeggcute: plain("exeggcute", 102, "Exeggcute", "#f0d8a8", round(120, 154, 70)),
  exeggutor: plain("exeggutor", 103, "Exeggutor", "#e8cc94", blob(120, 92, 134, 122)),
  cubone: plain("cubone", 104, "Cubone", "#d8b878", blob(120, 102, 120, 112)),
  marowak: plain("marowak", 105, "Marowak", "#cba868", blob(120, 96, 128, 118)),
  hitmonlee: plain("hitmonlee", 106, "Hitmonlee", "#d8b4a0", blob(120, 100, 118, 114)),
  hitmonchan: plain("hitmonchan", 107, "Hitmonchan", "#c8a48c", blob(120, 98, 124, 116)),
  lickitung: plain("lickitung", 108, "Lickitung", "#f0b6c8", blob(120, 98, 128, 116)),
  koffing: plain("koffing", 109, "Koffing", "#a07ab8", round(120, 150, 76)),
  weezing: plain("weezing", 110, "Weezing", "#9470ac", round(120, 148, 82)),
  rhyhorn: plain("rhyhorn", 111, "Rhyhorn", "#b0a8b8", blob(120, 100, 128, 114)),
  rhydon: plain("rhydon", 112, "Rhydon", "#a29aab", blob(120, 94, 134, 120)),
  chansey: plain("chansey", 113, "Chansey", "#f2b6c6", round(120, 152, 76)),
  tangela: plain("tangela", 114, "Tangela", "#5aa0c8", round(120, 152, 74)),
  kangaskhan: plain("kangaskhan", 115, "Kangaskhan", "#c09a6b", blob(120, 96, 130, 118)),
  horsea: plain("horsea", 116, "Horsea", "#7ab8d8", blob(120, 104, 116, 110)),
  seadra: plain("seadra", 117, "Seadra", "#6aa8cc", blob(120, 100, 122, 114)),
  goldeen: plain("goldeen", 118, "Goldeen", "#f0e0d8", blob(120, 104, 118, 110)),
  seaking: plain("seaking", 119, "Seaking", "#ecdbd0", blob(120, 98, 126, 116)),
  staryu: plain("staryu", 120, "Staryu", "#e0b87a", round(120, 152, 70)),
  starmie: plain("starmie", 121, "Starmie", "#9a7ac4", round(120, 150, 76)),
  "mr-mime": plain("mr-mime", 122, "Mr. Mime", "#f0c6d4", blob(120, 100, 124, 114)),
  scyther: plain("scyther", 123, "Scyther", "#8ac06a", blob(120, 98, 128, 116)),
  jynx: plain("jynx", 124, "Jynx", "#c88ad0", blob(120, 100, 122, 114)),
  electabuzz: plain("electabuzz", 125, "Electabuzz", "#f0c83e", blob(120, 98, 126, 116)),
  magmar: plain("magmar", 126, "Magmar", "#e8683a", blob(120, 96, 128, 118)),
  pinsir: plain("pinsir", 127, "Pinsir", "#b08a5a", blob(120, 98, 126, 116)),
  tauros: plain("tauros", 128, "Tauros", "#b89a6a", blob(120, 96, 130, 118)),
  magikarp: plain("magikarp", 129, "Magikarp", "#e05a3a", blob(120, 104, 120, 110)),
  gyarados: plain("gyarados", 130, "Gyarados", "#5a8ac4", blob(120, 92, 134, 122)),
  lapras: plain("lapras", 131, "Lapras", "#6a9ad4", blob(120, 98, 130, 116)),
  ditto: plain("ditto", 132, "Ditto", "#b48ad4", round(120, 154, 72)),
  eevee: plain("eevee", 133, "Eevee", "#c89a5a", blob(120, 100, 122, 114)),
  vaporeon: plain("vaporeon", 134, "Vaporeon", "#5aaad4", blob(120, 98, 128, 116)),
  jolteon: plain("jolteon", 135, "Jolteon", "#f0d44f", blob(120, 98, 126, 116)),
  flareon: plain("flareon", 136, "Flareon", "#e8723a", blob(120, 98, 128, 116)),
  porygon: plain("porygon", 137, "Porygon", "#e07ab0", blob(120, 100, 124, 114)),
  omanyte: plain("omanyte", 138, "Omanyte", "#6a9ac0", round(120, 152, 70)),
  omastar: plain("omastar", 139, "Omastar", "#5a8ab0", round(120, 150, 76)),
  kabuto: plain("kabuto", 140, "Kabuto", "#b8845a", ellipse(120, 156, 62, 64)),
  kabutops: plain("kabutops", 141, "Kabutops", "#a8744c", blob(120, 96, 128, 118)),
  aerodactyl: plain("aerodactyl", 142, "Aerodactyl", "#a09ab0", blob(120, 94, 132, 120)),
  snorlax: plain("snorlax", 143, "Snorlax", "#5a8a9a", blob(120, 88, 140, 126)),
  articuno: plain("articuno", 144, "Articuno", "#5ab0d8", blob(120, 92, 130, 122)),
  zapdos: plain("zapdos", 145, "Zapdos", "#e0c43e", blob(120, 92, 130, 122)),
  moltres: plain("moltres", 146, "Moltres", "#e86a3a", blob(120, 92, 130, 122)),
  dratini: plain("dratini", 147, "Dratini", "#5aa8c8", blob(120, 104, 118, 110)),
  dragonair: plain("dragonair", 148, "Dragonair", "#5a96c8", blob(120, 98, 126, 116)),
  dragonite: plain("dragonite", 149, "Dragonite", "#e0b04a", blob(120, 94, 132, 120)),
  mewtwo: plain("mewtwo", 150, "Mewtwo", "#c8c0d4", blob(120, 94, 130, 120)),
  mew: plain("mew", 151, "Mew", "#f0b8d0", round(120, 152, 72)),
};
