/**
 * The Pokémon bodies a bot can wear: the first 151, drawn as flat shapes in the mascot's own
 * 240-unit square (the same contract as halloween-bodies.ts).
 *
 * GENERATED FILE — do not hand-edit. Run `pnpm gen:pokemon` to rebuild it from
 * `scripts/gen-pokemon-bodies.ts`.
 *
 * Each one is an archetype silhouette — quadruped, bird, fish, serpent, insect, ghost, blob,
 * shelled — plus the two or three marks that make the creature recognisable: ears, a horn, a leaf,
 * a flame tail, wings, fins. Every one wears the same carved face, so the mascot still reads as one
 * character in different costumes.
 *
 * These are flat interpretations, not copies of any original artwork.
 */
export interface PokemonEyes {
  cx: number;
  cy: number;
  dx: number;
  w: number;
  h: number;
  round: number;
  ink: string;
  mouth: boolean;
  mouthInk: string;
  mouthY: number | null;
}

export interface PokemonBody {
  id: string;
  /** The National Pokédex number, which is also the order the picker shows them in. */
  number: number;
  name: string;
  /** "bot" follows the bot's colour; "species" keeps `color`, so the creature reads at a glance. */
  paint: "bot" | "species";
  color: string;
  /** The second colour its marks use, when the drawing needs one. */
  accent: string;
  /** Draw order, bottom first. `body` is the paint, `accent` the second colour, or a literal. */
  parts: ReadonlyArray<{ fill: string; d: string }>;
  eyes: PokemonEyes;
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

const INK = "#0d0a10";

/** The face every body wears, placed where its archetype's head sits. */
const face = (cx: number, cy: number, dx: number, h: number, mouth = true): PokemonEyes =>
  ({ cx, cy, dx, w: 22, h, round: Math.max(h, 22), ink: INK, mouth, mouthInk: INK, mouthY: null });

export const POKEMON_BODIES: Record<PokemonBodyId, PokemonBody> = {
  bulbasaur: {
    id: "bulbasaur", number: 1, name: "Bulbasaur", paint: "species", color: "#7ac74c", accent: "#3f7a2e",
    parts: [
      { fill: "accent", d: "M64 150 C40 146 34 122 44 106 C50 96 62 94 70 100 C60 116 58 134 70 146 Z" },
      { fill: "accent", d: "M176 150 C200 146 206 122 196 106 C190 96 178 94 170 100 C180 116 182 134 170 146 Z" },
      { fill: "body", d: "M64 200 C58 168 62 134 80 118 C96 104 144 104 160 118 C178 134 182 168 176 200 C168 214 72 214 64 200 Z" },
      { fill: "accent", d: "M92 118 C88 100 96 88 108 84 C100 96 100 108 108 116 Z" },
      { fill: "accent", d: "M148 118 C152 100 144 88 132 84 C140 96 140 108 132 116 Z" },
    ],
    eyes: face(120, 152, 34, 34), clip: "M64 200 C58 168 62 134 80 118 C96 104 144 104 160 118 C178 134 182 168 176 200 C168 214 72 214 64 200 Z",
  },
  ivysaur: {
    id: "ivysaur", number: 2, name: "Ivysaur", paint: "species", color: "#6fbf5a", accent: "#e04a7c",
    parts: [
      { fill: "accent", d: "M74 120 C54 108 50 84 64 72 C68 90 76 104 92 112 Z" },
      { fill: "accent", d: "M166 120 C186 108 190 84 176 72 C172 90 164 104 148 112 Z" },
      { fill: "body", d: "M62 204 C56 170 62 134 82 118 C98 104 142 104 158 118 C178 134 184 170 178 204 C168 218 72 218 62 204 Z" },
      { fill: "accent", d: "M104 110 C104 92 112 80 120 74 C128 80 136 92 136 110 Z" },
    ],
    eyes: face(120, 154, 34, 32), clip: "M62 204 C56 170 62 134 82 118 C98 104 142 104 158 118 C178 134 184 170 178 204 C168 218 72 218 62 204 Z",
  },
  venusaur: {
    id: "venusaur", number: 3, name: "Venusaur", paint: "species", color: "#63b04f", accent: "#dd5480",
    parts: [
      { fill: "accent", d: "M56 116 C34 100 34 70 52 58 C56 80 66 98 86 108 Z" },
      { fill: "accent", d: "M184 116 C206 100 206 70 188 58 C184 80 174 98 154 108 Z" },
      { fill: "body", d: "M52 208 C44 172 52 132 76 114 C96 98 144 98 164 114 C188 132 196 172 188 208 C176 222 64 222 52 208 Z" },
      { fill: "accent", d: "M84 108 C82 86 94 70 120 62 C146 70 158 86 156 108 Z" },
    ],
    eyes: face(120, 158, 36, 30), clip: "M52 208 C44 172 52 132 76 114 C96 98 144 98 164 114 C188 132 196 172 188 208 C176 222 64 222 52 208 Z",
  },
  charmander: {
    id: "charmander", number: 4, name: "Charmander", paint: "species", color: "#f0883e", accent: "#ffd166",
    parts: [
      { fill: "accent", d: "M164 204 C196 196 208 168 200 142 C214 170 208 206 178 218 C166 222 154 216 150 208 Z" },
      { fill: "body", d: "M86 96 C86 74 154 74 154 96 C172 112 178 140 176 166 C174 194 160 206 120 206 C80 206 66 194 64 166 C62 140 68 112 86 96 Z" },
    ],
    eyes: face(120, 140, 30, 32), clip: "M86 96 C86 74 154 74 154 96 C172 112 178 140 176 166 C174 194 160 206 120 206 C80 206 66 194 64 166 C62 140 68 112 86 96 Z",
  },
  charmeleon: {
    id: "charmeleon", number: 5, name: "Charmeleon", paint: "species", color: "#e2683c", accent: "#ffcf5c",
    parts: [
      { fill: "accent", d: "M166 202 C200 192 212 160 204 134 C218 164 212 202 180 216 C168 220 156 214 152 206 Z" },
      { fill: "accent", d: "M92 96 L74 62 L108 78 Z" },
      { fill: "body", d: "M84 92 C84 70 156 70 156 92 C174 110 180 140 178 168 C176 198 158 212 120 212 C82 212 64 198 62 168 C60 140 66 110 84 92 Z" },
    ],
    eyes: face(120, 138, 30, 30), clip: "M84 92 C84 70 156 70 156 92 C174 110 180 140 178 168 C176 198 158 212 120 212 C82 212 64 198 62 168 C60 140 66 110 84 92 Z",
  },
  charizard: {
    id: "charizard", number: 6, name: "Charizard", paint: "species", color: "#ef7f3a", accent: "#4fa3c7",
    parts: [
      { fill: "accent", d: "M108 140 L26 86 L40 146 L18 190 L92 166 Z" },
      { fill: "accent", d: "M132 140 L214 86 L200 146 L222 190 L148 166 Z" },
      { fill: "accent", d: "M158 208 C196 200 208 168 200 142 C214 172 208 212 176 224 C164 228 152 222 148 214 Z" },
      { fill: "body", d: "M88 90 C88 68 152 68 152 90 C170 108 176 138 174 166 C172 196 156 208 120 208 C84 208 68 196 66 166 C64 138 70 108 88 90 Z" },
    ],
    eyes: face(120, 136, 30, 30), clip: "M88 90 C88 68 152 68 152 90 C170 108 176 138 174 166 C172 196 156 208 120 208 C84 208 68 196 66 166 C64 138 70 108 88 90 Z",
  },
  squirtle: {
    id: "squirtle", number: 7, name: "Squirtle", paint: "species", color: "#6ec5e9", accent: "#c07a42",
    parts: [
      { fill: "accent", d: "M62 178 C62 140 178 140 178 178 C178 200 62 200 62 178 Z" },
      { fill: "body", d: "M88 92 C88 70 152 70 152 92 C170 110 176 138 174 164 C172 192 158 204 120 204 C82 204 68 192 66 164 C64 138 70 110 88 92 Z" },
    ],
    eyes: face(120, 138, 30, 32), clip: "M88 92 C88 70 152 70 152 92 C170 110 176 138 174 164 C172 192 158 204 120 204 C82 204 68 192 66 164 C64 138 70 110 88 92 Z",
  },
  wartortle: {
    id: "wartortle", number: 8, name: "Wartortle", paint: "species", color: "#5fa8d8", accent: "#e8e8f0",
    parts: [
      { fill: "accent", d: "M62 180 C62 140 178 140 178 180 C178 202 62 202 62 180 Z" },
      { fill: "accent", d: "M96 92 C84 74 80 52 94 44 C98 62 106 80 118 88 Z" },
      { fill: "body", d: "M86 90 C86 68 154 68 154 90 C172 108 178 138 176 166 C174 196 158 208 120 208 C82 208 66 196 64 166 C62 138 68 108 86 90 Z" },
    ],
    eyes: face(120, 136, 30, 32), clip: "M86 90 C86 68 154 68 154 90 C172 108 178 138 176 166 C174 196 158 208 120 208 C82 208 66 196 64 166 C62 138 68 108 86 90 Z",
  },
  blastoise: {
    id: "blastoise", number: 9, name: "Blastoise", paint: "species", color: "#4f8fc0", accent: "#c8c8d0",
    parts: [
      { fill: "accent", d: "M58 182 C58 138 182 138 182 182 C182 206 58 206 58 182 Z" },
      { fill: "accent", d: "M46 132 L28 108 L52 112 Z" },
      { fill: "accent", d: "M194 132 L212 108 L188 112 Z" },
      { fill: "body", d: "M84 86 C84 62 156 62 156 86 C176 106 182 138 180 168 C178 200 160 212 120 212 C80 212 62 200 60 168 C58 138 64 106 84 86 Z" },
    ],
    eyes: face(120, 132, 32, 32), clip: "M84 86 C84 62 156 62 156 86 C176 106 182 138 180 168 C178 200 160 212 120 212 C80 212 62 200 60 168 C58 138 64 106 84 86 Z",
  },
  caterpie: {
    id: "caterpie", number: 10, name: "Caterpie", paint: "species", color: "#8fce4f", accent: "#e8d44f",
    parts: [
      { fill: "body", d: "M70 194 C60 156 66 120 90 106 C104 98 136 98 150 106 C174 120 180 156 170 194 C160 206 80 206 70 194 Z" },
      { fill: "accent", d: "M120 100 L120 76" },
      { fill: "accent", d: "M112 78 C100 66 100 50 112 42 C118 54 124 66 128 78 Z" },
    ],
    eyes: face(120, 150, 32, 34), clip: "M70 194 C60 156 66 120 90 106 C104 98 136 98 150 106 C174 120 180 156 170 194 C160 206 80 206 70 194 Z",
  },
  metapod: {
    id: "metapod", number: 11, name: "Metapod", paint: "species", color: "#7fb84a", accent: "#5f9436",
    parts: [
      { fill: "accent", d: "M120 62 C150 62 174 96 174 138 C174 180 150 200 120 200 C90 200 66 180 66 138 C66 96 90 62 120 62 Z" },
      { fill: "body", d: "M120 74 C144 74 164 104 164 138 C164 172 144 190 120 190 C96 190 76 172 76 138 C76 104 96 74 120 74 Z" },
    ],
    eyes: face(120, 142, 28, 26), clip: "M120 74 C144 74 164 104 164 138 C164 172 144 190 120 190 C96 190 76 172 76 138 C76 104 96 74 120 74 Z",
  },
  butterfree: {
    id: "butterfree", number: 12, name: "Butterfree", paint: "species", color: "#7fb2e5", accent: "#f0f0f8",
    parts: [
      { fill: "accent", d: "M96 130 C56 100 34 118 44 156 C50 180 76 186 100 168 Z" },
      { fill: "accent", d: "M144 130 C184 100 206 118 196 156 C190 180 164 186 140 168 Z" },
      { fill: "body", d: "M100 196 C92 160 96 124 120 108 C144 124 148 160 140 196 C132 206 108 206 100 196 Z" },
      { fill: "accent", d: "M104 110 C96 90 100 74 112 66" },
      { fill: "accent", d: "M136 110 C144 90 140 74 128 66" },
    ],
    eyes: face(120, 148, 24, 30), clip: "M100 196 C92 160 96 124 120 108 C144 124 148 160 140 196 C132 206 108 206 100 196 Z",
  },
  weedle: {
    id: "weedle", number: 13, name: "Weedle", paint: "species", color: "#c8a24a", accent: "#e0e0e8",
    parts: [
      { fill: "body", d: "M66 196 C58 160 64 124 88 108 C104 98 136 98 152 108 C176 124 182 160 174 196 C164 208 76 208 66 196 Z" },
      { fill: "accent", d: "M120 104 L120 66" },
      { fill: "accent", d: "M120 68 L112 48 L128 48 Z" },
    ],
    eyes: face(120, 152, 32, 32), clip: "M66 196 C58 160 64 124 88 108 C104 98 136 98 152 108 C176 124 182 160 174 196 C164 208 76 208 66 196 Z",
  },
  kakuna: {
    id: "kakuna", number: 14, name: "Kakuna", paint: "species", color: "#c8b44e", accent: "#8f7f36",
    parts: [
      { fill: "accent", d: "M120 66 C148 66 168 100 168 140 C168 178 148 198 120 198 C92 198 72 178 72 140 C72 100 92 66 120 66 Z" },
      { fill: "body", d: "M120 78 C142 78 158 106 158 140 C158 170 142 186 120 186 C98 186 82 170 82 140 C82 106 98 78 120 78 Z" },
    ],
    eyes: face(120, 142, 26, 26), clip: "M120 78 C142 78 158 106 158 140 C158 170 142 186 120 186 C98 186 82 170 82 140 C82 106 98 78 120 78 Z",
  },
  beedrill: {
    id: "beedrill", number: 15, name: "Beedrill", paint: "species", color: "#e0c341", accent: "#3d3d3d",
    parts: [
      { fill: "accent", d: "M92 128 C54 98 34 116 44 152 C50 176 74 182 96 164 Z" },
      { fill: "accent", d: "M148 128 C186 98 206 116 196 152 C190 176 166 182 144 164 Z" },
      { fill: "body", d: "M102 194 C94 158 98 122 120 106 C142 122 146 158 138 194 C130 204 110 204 102 194 Z" },
      { fill: "accent", d: "M120 108 L120 82 L106 92 Z" },
      { fill: "accent", d: "M120 108 L120 82 L134 92 Z" },
    ],
    eyes: face(120, 146, 24, 28), clip: "M102 194 C94 158 98 122 120 106 C142 122 146 158 138 194 C130 204 110 204 102 194 Z",
  },
  pidgey: {
    id: "pidgey", number: 16, name: "Pidgey", paint: "species", color: "#cbb28a", accent: "#8f7654",
    parts: [
      { fill: "accent", d: "M74 140 C52 128 46 108 56 96 C60 114 70 128 84 134 Z" },
      { fill: "body", d: "M84 190 C74 152 82 112 120 98 C158 112 166 152 156 190 C146 204 94 204 84 190 Z" },
      { fill: "accent", d: "M120 100 L112 74 L128 74 Z" },
    ],
    eyes: face(120, 140, 30, 32), clip: "M84 190 C74 152 82 112 120 98 C158 112 166 152 156 190 C146 204 94 204 84 190 Z",
  },
  pidgeotto: {
    id: "pidgeotto", number: 17, name: "Pidgeotto", paint: "species", color: "#c39b6b", accent: "#e0c04a",
    parts: [
      { fill: "accent", d: "M72 138 C48 124 42 102 54 90 C58 110 70 126 84 132 Z" },
      { fill: "accent", d: "M168 138 C192 124 198 102 186 90 C182 110 170 126 156 132 Z" },
      { fill: "body", d: "M82 192 C72 152 80 110 120 96 C160 110 168 152 158 192 C148 206 92 206 82 192 Z" },
      { fill: "accent", d: "M120 98 L114 68 L126 68 Z" },
    ],
    eyes: face(120, 138, 32, 32), clip: "M82 192 C72 152 80 110 120 96 C160 110 168 152 158 192 C148 206 92 206 82 192 Z",
  },
  pidgeot: {
    id: "pidgeot", number: 18, name: "Pidgeot", paint: "species", color: "#b98a5c", accent: "#e8c84a",
    parts: [
      { fill: "accent", d: "M70 136 C42 120 36 96 50 84 C54 106 68 124 84 130 Z" },
      { fill: "accent", d: "M170 136 C198 120 204 96 190 84 C186 106 172 124 156 130 Z" },
      { fill: "body", d: "M80 194 C70 152 78 108 120 94 C162 108 170 152 160 194 C150 208 90 208 80 194 Z" },
      { fill: "accent", d: "M120 96 C104 78 104 58 120 48 C136 58 136 78 120 96 Z" },
    ],
    eyes: face(120, 136, 32, 32), clip: "M80 194 C70 152 78 108 120 94 C162 108 170 152 160 194 C150 208 90 208 80 194 Z",
  },
  rattata: {
    id: "rattata", number: 19, name: "Rattata", paint: "species", color: "#a98bc4", accent: "#f0e8f8",
    parts: [
      { fill: "accent", d: "M162 196 C196 186 200 158 186 140 C204 166 196 200 168 210 C160 212 154 208 152 202 Z" },
      { fill: "accent", d: "M92 106 C78 84 74 62 88 56 C94 74 102 92 114 102 Z" },
      { fill: "body", d: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z" },
    ],
    eyes: face(120, 142, 30, 32), clip: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z",
  },
  raticate: {
    id: "raticate", number: 20, name: "Raticate", paint: "species", color: "#a07ab8", accent: "#f0e0d0",
    parts: [
      { fill: "accent", d: "M164 194 C200 184 206 152 190 134 C210 162 202 200 172 212 C164 214 156 210 154 204 Z" },
      { fill: "accent", d: "M90 104 C74 82 72 58 88 52 C94 72 102 90 114 100 Z" },
      { fill: "accent", d: "M150 104 C166 82 168 58 152 52 C146 72 138 90 126 100 Z" },
      { fill: "body", d: "M82 192 C72 152 80 112 120 98 C160 112 168 152 158 192 C148 206 92 206 82 192 Z" },
    ],
    eyes: face(120, 140, 32, 32), clip: "M82 192 C72 152 80 112 120 98 C160 112 168 152 158 192 C148 206 92 206 82 192 Z",
  },
  spearow: {
    id: "spearow", number: 21, name: "Spearow", paint: "species", color: "#b08154", accent: "#e05a4a",
    parts: [
      { fill: "accent", d: "M76 140 C52 128 46 106 56 94 C60 112 70 126 86 132 Z" },
      { fill: "body", d: "M86 190 C76 152 84 112 120 98 C156 112 164 152 154 190 C144 204 96 204 86 190 Z" },
      { fill: "accent", d: "M120 102 L104 76 L136 76 Z" },
    ],
    eyes: face(120, 140, 30, 32), clip: "M86 190 C76 152 84 112 120 98 C156 112 164 152 154 190 C144 204 96 204 86 190 Z",
  },
  fearow: {
    id: "fearow", number: 22, name: "Fearow", paint: "species", color: "#a3714a", accent: "#e0644a",
    parts: [
      { fill: "accent", d: "M74 138 C48 126 42 102 54 90 C58 110 70 126 86 132 Z" },
      { fill: "body", d: "M84 192 C74 152 82 110 120 96 C158 110 166 152 156 192 C146 206 94 206 84 192 Z" },
      { fill: "accent", d: "M120 100 C102 80 100 58 120 46 C140 58 138 80 120 100 Z" },
      { fill: "accent", d: "M120 54 L112 34 L128 34 Z" },
    ],
    eyes: face(120, 138, 32, 32), clip: "M84 192 C74 152 82 110 120 96 C158 110 166 152 156 192 C146 206 94 206 84 192 Z",
  },
  ekans: {
    id: "ekans", number: 23, name: "Ekans", paint: "species", color: "#a86fc4", accent: "#e0c04a",
    parts: [
      { fill: "body", d: "M54 200 C44 172 56 150 84 144 C112 138 136 150 148 172 C154 184 150 194 140 196 C132 198 128 190 132 180 C140 160 128 148 108 152 C88 156 78 170 86 186 C90 194 84 200 76 200 Z" },
      { fill: "body", d: "M120 74 C152 74 172 104 172 138 C172 166 152 182 120 182 C88 182 68 166 68 138 C68 104 88 74 120 74 Z" },
      { fill: "accent", d: "M96 90 L92 66 L106 80 Z" },
      { fill: "accent", d: "M144 90 L148 66 L134 80 Z" },
    ],
    eyes: face(120, 128, 30, 30), clip: "M120 74 C152 74 172 104 172 138 C172 166 152 182 120 182 C88 182 68 166 68 138 C68 104 88 74 120 74 Z",
  },
  arbok: {
    id: "arbok", number: 24, name: "Arbok", paint: "species", color: "#8f5aa8", accent: "#e0c04a",
    parts: [
      { fill: "body", d: "M48 202 C38 172 52 148 82 142 C114 136 140 150 152 176 C158 190 152 200 140 200 C132 200 128 192 132 182 C140 160 126 146 106 150 C84 154 74 172 84 190 C90 200 80 206 70 206 Z" },
      { fill: "body", d: "M120 68 C156 68 178 100 178 138 C178 170 156 186 120 186 C84 186 62 170 62 138 C62 100 84 68 120 68 Z" },
      { fill: "accent", d: "M92 84 L84 58 L102 74 Z" },
      { fill: "accent", d: "M148 84 L156 58 L138 74 Z" },
    ],
    eyes: face(120, 124, 32, 30), clip: "M120 68 C156 68 178 100 178 138 C178 170 156 186 120 186 C84 186 62 170 62 138 C62 100 84 68 120 68 Z",
  },
  pikachu: {
    id: "pikachu", number: 25, name: "Pikachu", paint: "species", color: "#f5d33f", accent: "#3a2f22",
    parts: [
      { fill: "accent", d: "M88 104 C72 84 64 52 76 32 C86 56 96 84 106 100 Z" },
      { fill: "accent", d: "M152 104 C168 84 176 52 164 32 C154 56 144 84 134 100 Z" },
      { fill: "body", d: "M84 192 C74 152 82 112 120 98 C158 112 166 152 156 192 C146 206 94 206 84 192 Z" },
      { fill: "accent", d: "M96 168 C88 168 86 178 94 180 C102 182 108 174 104 168 Z" },
      { fill: "accent", d: "M144 168 C152 168 154 178 146 180 C138 182 132 174 136 168 Z" },
    ],
    eyes: face(120, 138, 32, 32), clip: "M84 192 C74 152 82 112 120 98 C158 112 166 152 156 192 C146 206 94 206 84 192 Z",
  },
  raichu: {
    id: "raichu", number: 26, name: "Raichu", paint: "species", color: "#f0a23e", accent: "#3a2f22",
    parts: [
      { fill: "accent", d: "M86 102 C68 82 62 56 74 44 C84 64 94 86 106 98 Z" },
      { fill: "accent", d: "M154 102 C172 82 178 56 166 44 C156 64 146 86 134 98 Z" },
      { fill: "body", d: "M82 192 C72 150 80 110 120 96 C160 110 168 150 158 192 C148 206 92 206 82 192 Z" },
      { fill: "accent", d: "M164 196 C200 186 204 156 190 138 C208 164 200 202 172 212 C164 214 158 210 156 202 Z" },
    ],
    eyes: face(120, 136, 32, 32), clip: "M82 192 C72 150 80 110 120 96 C160 110 168 150 158 192 C148 206 92 206 82 192 Z",
  },
  sandshrew: {
    id: "sandshrew", number: 27, name: "Sandshrew", paint: "species", color: "#e0c073", accent: "#a8843e",
    parts: [
      { fill: "body", d: "M64 190 C56 156 66 118 120 108 C174 118 184 156 176 190 C166 204 74 204 64 190 Z" },
      { fill: "accent", d: "M86 128 L74 108 L96 114 Z" },
      { fill: "accent", d: "M154 128 L166 108 L144 114 Z" },
      { fill: "accent", d: "M120 112 L120 92 L132 100 Z" },
    ],
    eyes: face(120, 150, 32, 30), clip: "M64 190 C56 156 66 118 120 108 C174 118 184 156 176 190 C166 204 74 204 64 190 Z",
  },
  sandslash: {
    id: "sandslash", number: 28, name: "Sandslash", paint: "species", color: "#cfa75c", accent: "#8f7038",
    parts: [
      { fill: "body", d: "M62 192 C54 154 64 114 120 104 C176 114 186 154 178 192 C168 206 72 206 62 192 Z" },
      { fill: "accent", d: "M84 126 L68 100 L96 110 Z" },
      { fill: "accent", d: "M156 126 L172 100 L144 110 Z" },
      { fill: "accent", d: "M104 112 L120 84 L136 112 Z" },
    ],
    eyes: face(120, 148, 32, 30), clip: "M62 192 C54 154 64 114 120 104 C176 114 186 154 178 192 C168 206 72 206 62 192 Z",
  },
  "nidoran-f": {
    id: "nidoran-f", number: 29, name: "Nidoran♀", paint: "species", color: "#a8c8e8", accent: "#6f94bc",
    parts: [
      { fill: "accent", d: "M92 108 C82 86 84 62 96 54 C100 74 104 92 112 104 Z" },
      { fill: "body", d: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z" },
    ],
    eyes: face(120, 142, 30, 32), clip: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z",
  },
  nidorina: {
    id: "nidorina", number: 30, name: "Nidorina", paint: "species", color: "#94bce0", accent: "#5f86ad",
    parts: [
      { fill: "accent", d: "M92 106 C80 84 82 58 96 48 C100 70 104 90 112 102 Z" },
      { fill: "body", d: "M82 192 C72 152 80 112 120 98 C160 112 168 152 158 192 C148 206 92 206 82 192 Z" },
    ],
    eyes: face(120, 140, 30, 32), clip: "M82 192 C72 152 80 112 120 98 C160 112 168 152 158 192 C148 206 92 206 82 192 Z",
  },
  nidoqueen: {
    id: "nidoqueen", number: 31, name: "Nidoqueen", paint: "species", color: "#7aa8d4", accent: "#5f86ad",
    parts: [
      { fill: "accent", d: "M94 104 C82 82 86 56 100 46 C104 68 108 88 114 100 Z" },
      { fill: "body", d: "M78 194 C68 152 78 108 120 94 C162 108 172 152 162 194 C150 208 90 208 78 194 Z" },
      { fill: "accent", d: "M78 160 C58 160 56 186 76 188 Z" },
      { fill: "accent", d: "M162 160 C182 160 184 186 164 188 Z" },
    ],
    eyes: face(120, 138, 32, 30), clip: "M78 194 C68 152 78 108 120 94 C162 108 172 152 162 194 C150 208 90 208 78 194 Z",
  },
  "nidoran-m": {
    id: "nidoran-m", number: 32, name: "Nidoran♂", paint: "species", color: "#b48fd0", accent: "#8360a8",
    parts: [
      { fill: "accent", d: "M150 104 C168 84 174 56 162 42 C154 66 144 90 132 100 Z" },
      { fill: "body", d: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z" },
    ],
    eyes: face(120, 142, 30, 32), clip: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z",
  },
  nidorino: {
    id: "nidorino", number: 33, name: "Nidorino", paint: "species", color: "#a07ac0", accent: "#75539a",
    parts: [
      { fill: "accent", d: "M152 102 C172 82 180 52 168 38 C158 64 148 88 134 100 Z" },
      { fill: "body", d: "M82 192 C72 152 80 112 120 98 C160 112 168 152 158 192 C148 206 92 206 82 192 Z" },
    ],
    eyes: face(120, 140, 30, 32), clip: "M82 192 C72 152 80 112 120 98 C160 112 168 152 158 192 C148 206 92 206 82 192 Z",
  },
  nidoking: {
    id: "nidoking", number: 34, name: "Nidoking", paint: "species", color: "#8c66ad", accent: "#5f4480",
    parts: [
      { fill: "accent", d: "M154 100 C176 80 184 48 172 34 C160 62 150 86 136 98 Z" },
      { fill: "body", d: "M78 194 C68 152 78 108 120 94 C162 108 172 152 162 194 C150 208 90 208 78 194 Z" },
      { fill: "accent", d: "M78 158 C56 158 54 186 76 188 Z" },
      { fill: "accent", d: "M162 158 C184 158 186 186 164 188 Z" },
    ],
    eyes: face(120, 138, 32, 30), clip: "M78 194 C68 152 78 108 120 94 C162 108 172 152 162 194 C150 208 90 208 78 194 Z",
  },
  clefairy: {
    id: "clefairy", number: 35, name: "Clefairy", paint: "species", color: "#f2c6d4", accent: "#d89aae",
    parts: [
      { fill: "accent", d: "M90 108 C74 88 72 62 86 52 C92 72 98 92 108 104 Z" },
      { fill: "accent", d: "M150 108 C166 88 168 62 154 52 C148 72 142 92 132 104 Z" },
      { fill: "body", d: "M120 92 C160 92 178 130 178 162 C178 194 152 208 120 208 C88 208 62 194 62 162 C62 130 80 92 120 92 Z" },
    ],
    eyes: face(120, 146, 32, 32), clip: "M120 92 C160 92 178 130 178 162 C178 194 152 208 120 208 C88 208 62 194 62 162 C62 130 80 92 120 92 Z",
  },
  clefable: {
    id: "clefable", number: 36, name: "Clefable", paint: "species", color: "#efb6c8", accent: "#d48aa0",
    parts: [
      { fill: "accent", d: "M86 106 C68 86 66 58 82 48 C88 70 96 92 106 102 Z" },
      { fill: "accent", d: "M154 106 C172 86 174 58 158 48 C152 70 144 92 134 102 Z" },
      { fill: "body", d: "M120 88 C162 88 182 128 182 162 C182 196 154 212 120 212 C86 212 58 196 58 162 C58 128 78 88 120 88 Z" },
    ],
    eyes: face(120, 144, 34, 32), clip: "M120 88 C162 88 182 128 182 162 C182 196 154 212 120 212 C86 212 58 196 58 162 C58 128 78 88 120 88 Z",
  },
  vulpix: {
    id: "vulpix", number: 37, name: "Vulpix", paint: "species", color: "#e8813e", accent: "#f5d0a0",
    parts: [
      { fill: "accent", d: "M92 106 C76 84 74 56 88 44 C94 66 100 88 110 102 Z" },
      { fill: "accent", d: "M148 106 C164 84 166 56 152 44 C146 66 140 88 130 102 Z" },
      { fill: "body", d: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z" },
      { fill: "accent", d: "M120 148 C132 148 136 158 130 166 C124 172 116 172 110 166 C104 158 108 148 120 148 Z" },
    ],
    eyes: face(120, 140, 30, 30), clip: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z",
  },
  ninetales: {
    id: "ninetales", number: 38, name: "Ninetales", paint: "species", color: "#e0a24f", accent: "#f7e2b8",
    parts: [
      { fill: "accent", d: "M70 190 C46 176 40 146 54 128 C58 152 66 174 82 184 Z" },
      { fill: "accent", d: "M170 190 C194 176 200 146 186 128 C182 152 174 174 158 184 Z" },
      { fill: "body", d: "M86 190 C76 152 84 112 120 98 C156 112 164 152 154 190 C144 204 96 204 86 190 Z" },
      { fill: "accent", d: "M120 102 C108 82 108 60 120 50 C132 60 132 82 120 102 Z" },
    ],
    eyes: face(120, 138, 30, 30), clip: "M86 190 C76 152 84 112 120 98 C156 112 164 152 154 190 C144 204 96 204 86 190 Z",
  },
  jigglypuff: {
    id: "jigglypuff", number: 39, name: "Jigglypuff", paint: "species", color: "#f2b6cf", accent: "#d891aa",
    parts: [
      { fill: "body", d: "M120 74 C166 74 182 116 182 152 C182 190 154 204 120 204 C86 204 58 190 58 152 C58 116 74 74 120 74 Z" },
      { fill: "accent", d: "M120 74 C104 62 100 44 112 34 C120 46 124 60 128 74 Z" },
    ],
    eyes: face(120, 140, 34, 30), clip: "M120 74 C166 74 182 116 182 152 C182 190 154 204 120 204 C86 204 58 190 58 152 C58 116 74 74 120 74 Z",
  },
  wigglytuff: {
    id: "wigglytuff", number: 40, name: "Wigglytuff", paint: "species", color: "#f0a5c4", accent: "#d4789a",
    parts: [
      { fill: "body", d: "M120 68 C170 68 188 114 188 152 C188 192 158 208 120 208 C82 208 52 192 52 152 C52 114 70 68 120 68 Z" },
      { fill: "accent", d: "M88 100 C76 78 80 54 96 46 C100 68 104 90 112 100 Z" },
      { fill: "accent", d: "M152 100 C164 78 160 54 144 46 C140 68 136 90 128 100 Z" },
    ],
    eyes: face(120, 138, 34, 30), clip: "M120 68 C170 68 188 114 188 152 C188 192 158 208 120 208 C82 208 52 192 52 152 C52 114 70 68 120 68 Z",
  },
  zubat: {
    id: "zubat", number: 41, name: "Zubat", paint: "species", color: "#7a86c8", accent: "#5a66a8",
    parts: [
      { fill: "accent", d: "M100 132 L54 106 L68 158 L44 190 L96 172 Z" },
      { fill: "accent", d: "M140 132 L186 106 L172 158 L196 190 L144 172 Z" },
      { fill: "body", d: "M104 200 C96 164 100 128 120 112 C140 128 144 164 136 200 C130 210 110 210 104 200 Z" },
      { fill: "accent", d: "M106 116 L98 92 L112 106 Z" },
      { fill: "accent", d: "M134 116 L142 92 L128 106 Z" },
    ],
    eyes: face(120, 152, 22, 26, false), clip: "M104 200 C96 164 100 128 120 112 C140 128 144 164 136 200 C130 210 110 210 104 200 Z",
  },
  golbat: {
    id: "golbat", number: 42, name: "Golbat", paint: "species", color: "#6b78bd", accent: "#4d5a9c",
    parts: [
      { fill: "accent", d: "M98 128 L44 100 L60 158 L34 194 L94 172 Z" },
      { fill: "accent", d: "M142 128 L196 100 L180 158 L206 194 L146 172 Z" },
      { fill: "body", d: "M100 202 C92 164 96 126 120 110 C144 126 148 164 140 202 C132 214 108 214 100 202 Z" },
      { fill: "accent", d: "M104 114 L92 88 L110 104 Z" },
      { fill: "accent", d: "M136 114 L148 88 L130 104 Z" },
    ],
    eyes: face(120, 152, 24, 26, false), clip: "M100 202 C92 164 96 126 120 110 C144 126 148 164 140 202 C132 214 108 214 100 202 Z",
  },
  oddish: {
    id: "oddish", number: 43, name: "Oddish", paint: "species", color: "#6fb04f", accent: "#3f8a34",
    parts: [
      { fill: "accent", d: "M120 96 C104 76 102 50 116 38 C122 60 126 82 130 96 Z" },
      { fill: "accent", d: "M104 98 C84 84 74 58 86 42 C96 64 104 86 112 96 Z" },
      { fill: "accent", d: "M136 98 C156 84 166 58 154 42 C144 64 136 86 128 96 Z" },
      { fill: "body", d: "M120 100 C154 100 168 134 168 158 C168 188 148 200 120 200 C92 200 72 188 72 158 C72 134 86 100 120 100 Z" },
    ],
    eyes: face(120, 150, 30, 28), clip: "M120 100 C154 100 168 134 168 158 C168 188 148 200 120 200 C92 200 72 188 72 158 C72 134 86 100 120 100 Z",
  },
  gloom: {
    id: "gloom", number: 44, name: "Gloom", paint: "species", color: "#5f9e46", accent: "#d8566e",
    parts: [
      { fill: "accent", d: "M120 94 C102 72 100 44 116 32 C122 56 126 80 132 94 Z" },
      { fill: "accent", d: "M100 96 C78 80 68 52 82 36 C92 60 100 84 110 94 Z" },
      { fill: "accent", d: "M140 96 C162 80 172 52 158 36 C148 60 140 84 130 94 Z" },
      { fill: "body", d: "M120 98 C158 98 172 134 172 160 C172 190 150 202 120 202 C90 202 68 190 68 160 C68 134 82 98 120 98 Z" },
      { fill: "accent", d: "M120 152 C132 152 136 160 130 168 C124 174 116 174 110 168 C104 160 108 152 120 152 Z" },
    ],
    eyes: face(120, 146, 32, 26), clip: "M120 98 C158 98 172 134 172 160 C172 190 150 202 120 202 C90 202 68 190 68 160 C68 134 82 98 120 98 Z",
  },
  vileplume: {
    id: "vileplume", number: 45, name: "Vileplume", paint: "species", color: "#d05a6e", accent: "#e8b0c0",
    parts: [
      { fill: "accent", d: "M120 88 C92 88 76 62 96 48 C110 38 130 38 144 48 C164 62 148 88 120 88 Z" },
      { fill: "body", d: "M120 92 C160 92 176 130 176 158 C176 190 152 204 120 204 C88 204 64 190 64 158 C64 130 80 92 120 92 Z" },
    ],
    eyes: face(120, 146, 34, 28), clip: "M120 92 C160 92 176 130 176 158 C176 190 152 204 120 204 C88 204 64 190 64 158 C64 130 80 92 120 92 Z",
  },
  paras: {
    id: "paras", number: 46, name: "Paras", paint: "species", color: "#e28a4f", accent: "#e05a3a",
    parts: [
      { fill: "accent", d: "M84 104 C66 84 62 56 76 44 C84 66 92 88 104 100 Z" },
      { fill: "accent", d: "M156 104 C174 84 178 56 164 44 C156 66 148 88 136 100 Z" },
      { fill: "body", d: "M120 96 C156 96 172 130 172 158 C172 190 150 204 120 204 C90 204 68 190 68 158 C68 130 84 96 120 96 Z" },
    ],
    eyes: face(120, 148, 32, 30), clip: "M120 96 C156 96 172 130 172 158 C172 190 150 204 120 204 C90 204 68 190 68 158 C68 130 84 96 120 96 Z",
  },
  parasect: {
    id: "parasect", number: 47, name: "Parasect", paint: "species", color: "#cf7a42", accent: "#d04a30",
    parts: [
      { fill: "accent", d: "M120 92 C82 92 66 62 90 44 C110 30 130 30 150 44 C174 62 158 92 120 92 Z" },
      { fill: "body", d: "M120 96 C158 96 174 132 174 160 C174 192 150 206 120 206 C90 206 66 192 66 160 C66 132 82 96 120 96 Z" },
    ],
    eyes: face(120, 150, 32, 28), clip: "M120 96 C158 96 174 132 174 160 C174 192 150 206 120 206 C90 206 66 192 66 160 C66 132 82 96 120 96 Z",
  },
  venonat: {
    id: "venonat", number: 48, name: "Venonat", paint: "species", color: "#b08acb", accent: "#8a5fa8",
    parts: [
      { fill: "body", d: "M120 76 C164 76 184 112 184 146 C184 186 156 202 120 202 C84 202 56 186 56 146 C56 112 76 76 120 76 Z" },
      { fill: "accent", d: "M96 94 C84 74 88 50 104 42 C108 64 112 84 118 92 Z" },
      { fill: "accent", d: "M144 94 C156 74 152 50 136 42 C132 64 128 84 122 92 Z" },
    ],
    eyes: face(120, 142, 36, 34), clip: "M120 76 C164 76 184 112 184 146 C184 186 156 202 120 202 C84 202 56 186 56 146 C56 112 76 76 120 76 Z",
  },
  venomoth: {
    id: "venomoth", number: 49, name: "Venomoth", paint: "species", color: "#a479bd", accent: "#e0d8f0",
    parts: [
      { fill: "accent", d: "M98 130 C56 98 30 118 42 158 C50 184 78 188 102 168 Z" },
      { fill: "accent", d: "M142 130 C184 98 210 118 198 158 C190 184 162 188 138 168 Z" },
      { fill: "body", d: "M104 198 C96 162 100 126 120 112 C140 126 144 162 136 198 C130 208 110 208 104 198 Z" },
      { fill: "accent", d: "M110 116 C102 96 106 78 118 70" },
      { fill: "accent", d: "M130 116 C138 96 134 78 122 70" },
    ],
    eyes: face(120, 148, 24, 28), clip: "M104 198 C96 162 100 126 120 112 C140 126 144 162 136 198 C130 208 110 208 104 198 Z",
  },
  diglett: {
    id: "diglett", number: 50, name: "Diglett", paint: "species", color: "#c08a5a", accent: "#8f5f38",
    parts: [
      { fill: "body", d: "M120 156 C154 156 168 182 168 208 L72 208 C72 182 86 156 120 156 Z" },
      { fill: "accent", d: "M96 168 C80 158 76 142 86 134 C92 148 100 160 108 166 Z" },
      { fill: "accent", d: "M144 168 C160 158 164 142 154 134 C148 148 140 160 132 166 Z" },
    ],
    eyes: face(120, 176, 24, 24), clip: "M120 156 C154 156 168 182 168 208 L72 208 C72 182 86 156 120 156 Z",
  },
  dugtrio: {
    id: "dugtrio", number: 51, name: "Dugtrio", paint: "species", color: "#b07a4c", accent: "#83522c",
    parts: [
      { fill: "accent", d: "M64 170 C46 170 40 190 46 208 L94 208 C96 190 86 170 64 170 Z" },
      { fill: "accent", d: "M176 170 C194 170 200 190 194 208 L146 208 C144 190 154 170 176 170 Z" },
      { fill: "body", d: "M120 146 C152 146 166 176 166 208 L74 208 C74 176 88 146 120 146 Z" },
    ],
    eyes: face(120, 172, 22, 22), clip: "M120 146 C152 146 166 176 166 208 L74 208 C74 176 88 146 120 146 Z",
  },
  meowth: {
    id: "meowth", number: 52, name: "Meowth", paint: "species", color: "#f0dfa8", accent: "#c8a85a",
    parts: [
      { fill: "accent", d: "M92 106 C76 84 74 56 88 44 C94 66 100 88 110 102 Z" },
      { fill: "accent", d: "M148 106 C164 84 166 56 152 44 C146 66 140 88 130 102 Z" },
      { fill: "body", d: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z" },
      { fill: "accent", d: "M120 150 C126 150 128 156 124 160 C120 164 116 160 120 156 Z" },
    ],
    eyes: face(120, 140, 30, 32), clip: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z",
  },
  persian: {
    id: "persian", number: 53, name: "Persian", paint: "species", color: "#efd79a", accent: "#c8a858",
    parts: [
      { fill: "accent", d: "M90 104 C72 82 70 52 86 40 C92 64 98 88 110 100 Z" },
      { fill: "accent", d: "M150 104 C168 82 170 52 154 40 C148 64 142 88 130 100 Z" },
      { fill: "body", d: "M82 192 C72 152 80 112 120 98 C160 112 168 152 158 192 C148 206 92 206 82 192 Z" },
      { fill: "accent", d: "M120 146 C130 146 132 156 126 162 C120 166 114 162 120 156 Z" },
    ],
    eyes: face(120, 138, 32, 30), clip: "M82 192 C72 152 80 112 120 98 C160 112 168 152 158 192 C148 206 92 206 82 192 Z",
  },
  psyduck: {
    id: "psyduck", number: 54, name: "Psyduck", paint: "species", color: "#f0c85a", accent: "#c89a3a",
    parts: [
      { fill: "body", d: "M120 84 C158 84 178 122 178 154 C178 188 154 202 120 202 C86 202 62 188 62 154 C62 122 82 84 120 84 Z" },
      { fill: "accent", d: "M120 96 C110 76 112 54 124 44 C130 64 132 82 130 96 Z" },
      { fill: "accent", d: "M104 98 C88 84 82 60 94 50 C100 70 104 88 112 96 Z" },
    ],
    eyes: face(120, 140, 32, 32), clip: "M120 84 C158 84 178 122 178 154 C178 188 154 202 120 202 C86 202 62 188 62 154 C62 122 82 84 120 84 Z",
  },
  golduck: {
    id: "golduck", number: 55, name: "Golduck", paint: "species", color: "#5aa0cc", accent: "#e0c04a",
    parts: [
      { fill: "body", d: "M120 82 C160 82 180 120 180 152 C180 188 156 204 120 204 C84 204 60 188 60 152 C60 120 80 82 120 82 Z" },
      { fill: "accent", d: "M120 94 L112 62 L128 62 Z" },
      { fill: "accent", d: "M88 148 C70 144 66 160 78 170 Z" },
      { fill: "accent", d: "M152 148 C170 144 174 160 162 170 Z" },
    ],
    eyes: face(120, 136, 32, 30), clip: "M120 82 C160 82 180 120 180 152 C180 188 156 204 120 204 C84 204 60 188 60 152 C60 120 80 82 120 82 Z",
  },
  mankey: {
    id: "mankey", number: 56, name: "Mankey", paint: "species", color: "#e8d0b0", accent: "#b09068",
    parts: [
      { fill: "accent", d: "M84 106 C68 84 70 56 86 48 C90 72 96 92 106 102 Z" },
      { fill: "accent", d: "M156 106 C172 84 170 56 154 48 C150 72 144 92 134 102 Z" },
      { fill: "body", d: "M120 94 C158 94 172 130 172 160 C172 192 150 206 120 206 C90 206 68 192 68 160 C68 130 82 94 120 94 Z" },
    ],
    eyes: face(120, 142, 32, 30), clip: "M120 94 C158 94 172 130 172 160 C172 192 150 206 120 206 C90 206 68 192 68 160 C68 130 82 94 120 94 Z",
  },
  primeape: {
    id: "primeape", number: 57, name: "Primeape", paint: "species", color: "#ddc29e", accent: "#a8855c",
    parts: [
      { fill: "accent", d: "M82 104 C62 82 64 50 82 40 C88 66 94 90 106 100 Z" },
      { fill: "accent", d: "M158 104 C178 82 176 50 158 40 C152 66 146 90 134 100 Z" },
      { fill: "body", d: "M120 92 C160 92 174 130 174 162 C174 194 150 208 120 208 C90 208 66 194 66 162 C66 130 80 92 120 92 Z" },
      { fill: "accent", d: "M120 150 C134 150 138 162 130 170 C122 176 114 174 110 166 C106 156 112 150 120 150 Z" },
    ],
    eyes: face(120, 140, 34, 28), clip: "M120 92 C160 92 174 130 174 162 C174 194 150 208 120 208 C90 208 66 194 66 162 C66 130 80 92 120 92 Z",
  },
  growlithe: {
    id: "growlithe", number: 58, name: "Growlithe", paint: "species", color: "#e8894a", accent: "#f0d8a8",
    parts: [
      { fill: "accent", d: "M92 104 C76 82 76 54 92 44 C96 68 102 90 112 100 Z" },
      { fill: "accent", d: "M148 104 C164 82 164 54 148 44 C144 68 138 90 128 100 Z" },
      { fill: "body", d: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z" },
      { fill: "accent", d: "M120 148 C132 148 138 158 132 168 C126 174 114 174 108 168 C102 158 108 148 120 148 Z" },
    ],
    eyes: face(120, 140, 30, 30), clip: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z",
  },
  arcanine: {
    id: "arcanine", number: 59, name: "Arcanine", paint: "species", color: "#e2733a", accent: "#f0e0b8",
    parts: [
      { fill: "accent", d: "M86 110 C46 94 32 122 44 162 C54 188 82 190 100 168 Z" },
      { fill: "accent", d: "M154 110 C194 94 208 122 196 162 C186 188 158 190 140 168 Z" },
      { fill: "body", d: "M80 192 C70 152 78 110 120 96 C162 110 170 152 160 192 C150 206 90 206 80 192 Z" },
      { fill: "accent", d: "M104 100 C94 82 96 62 108 54 C112 74 116 90 120 98 Z" },
    ],
    eyes: face(120, 136, 32, 30), clip: "M80 192 C70 152 78 110 120 96 C162 110 170 152 160 192 C150 206 90 206 80 192 Z",
  },
  poliwag: {
    id: "poliwag", number: 60, name: "Poliwag", paint: "species", color: "#6fb8e0", accent: "#e8e8f0",
    parts: [
      { fill: "body", d: "M120 80 C164 80 180 118 180 152 C180 188 154 204 120 204 C86 204 60 188 60 152 C60 118 76 80 120 80 Z" },
      { fill: "accent", d: "M120 84 C128 84 130 96 126 112 C122 126 118 126 114 112 C110 96 112 84 120 84 Z" },
      { fill: "accent", d: "M100 92 C114 96 122 108 122 120 C110 116 100 106 100 92 Z" },
      { fill: "accent", d: "M140 92 C126 96 118 108 118 120 C130 116 140 106 140 92 Z" },
    ],
    eyes: face(120, 142, 32, 30), clip: "M120 80 C164 80 180 118 180 152 C180 188 154 204 120 204 C86 204 60 188 60 152 C60 118 76 80 120 80 Z",
  },
  poliwhirl: {
    id: "poliwhirl", number: 61, name: "Poliwhirl", paint: "species", color: "#5aa8d6", accent: "#e8e8f0",
    parts: [
      { fill: "body", d: "M120 82 C162 82 178 122 178 156 C178 190 152 204 120 204 C88 204 62 190 62 156 C62 122 78 82 120 82 Z" },
      { fill: "accent", d: "M92 154 C104 154 108 168 100 176 C92 182 82 176 82 166 C82 158 86 154 92 154 Z" },
      { fill: "accent", d: "M148 154 C136 154 132 168 140 176 C148 182 158 176 158 166 C158 158 154 154 148 154 Z" },
    ],
    eyes: face(120, 138, 32, 30), clip: "M120 82 C162 82 178 122 178 156 C178 190 152 204 120 204 C88 204 62 190 62 156 C62 122 78 82 120 82 Z",
  },
  poliwrath: {
    id: "poliwrath", number: 62, name: "Poliwrath", paint: "species", color: "#4288c0", accent: "#e0e0e8",
    parts: [
      { fill: "body", d: "M120 78 C164 78 182 120 182 156 C182 192 154 206 120 206 C86 206 58 192 58 156 C58 120 76 78 120 78 Z" },
      { fill: "accent", d: "M84 140 C66 136 62 156 74 166 Z" },
      { fill: "accent", d: "M156 140 C174 136 178 156 166 166 Z" },
      { fill: "accent", d: "M120 84 C128 84 130 96 126 110 C122 122 118 122 114 110 C110 96 112 84 120 84 Z" },
    ],
    eyes: face(120, 136, 34, 28), clip: "M120 78 C164 78 182 120 182 156 C182 192 154 206 120 206 C86 206 58 192 58 156 C58 120 76 78 120 78 Z",
  },
  abra: {
    id: "abra", number: 63, name: "Abra", paint: "species", color: "#e6c46a", accent: "#a88a3a",
    parts: [
      { fill: "accent", d: "M94 106 C82 88 84 64 96 56 C100 76 104 92 112 102 Z" },
      { fill: "accent", d: "M146 106 C158 88 156 64 144 56 C140 76 136 92 128 102 Z" },
      { fill: "body", d: "M120 94 C156 94 170 130 170 160 C170 192 148 206 120 206 C92 206 70 192 70 160 C70 130 84 94 120 94 Z" },
    ],
    eyes: face(120, 140, 32, 30), clip: "M120 94 C156 94 170 130 170 160 C170 192 148 206 120 206 C92 206 70 192 70 160 C70 130 84 94 120 94 Z",
  },
  kadabra: {
    id: "kadabra", number: 64, name: "Kadabra", paint: "species", color: "#dcb552", accent: "#8f3a5a",
    parts: [
      { fill: "accent", d: "M94 104 C80 84 82 58 96 50 C100 72 104 90 112 100 Z" },
      { fill: "accent", d: "M146 104 C160 84 158 58 144 50 C140 72 136 90 128 100 Z" },
      { fill: "body", d: "M120 92 C158 92 172 130 172 162 C172 194 148 208 120 208 C92 208 68 194 68 162 C68 130 82 92 120 92 Z" },
      { fill: "accent", d: "M120 146 C132 146 138 156 132 164 C126 170 114 170 108 164 C102 156 108 146 120 146 Z" },
    ],
    eyes: face(120, 138, 32, 30), clip: "M120 92 C158 92 172 130 172 162 C172 194 148 208 120 208 C92 208 68 194 68 162 C68 130 82 92 120 92 Z",
  },
  alakazam: {
    id: "alakazam", number: 65, name: "Alakazam", paint: "species", color: "#d0a83e", accent: "#8f3a5a",
    parts: [
      { fill: "accent", d: "M92 102 C76 82 78 54 94 44 C98 68 102 88 112 98 Z" },
      { fill: "accent", d: "M148 102 C164 82 162 54 146 44 C142 68 138 88 128 98 Z" },
      { fill: "body", d: "M120 88 C160 88 176 128 176 162 C176 196 150 210 120 210 C90 210 64 196 64 162 C64 128 80 88 120 88 Z" },
      { fill: "accent", d: "M120 144 L134 152 L134 168 L120 176 L106 168 L106 152 Z" },
    ],
    eyes: face(120, 136, 34, 28), clip: "M120 88 C160 88 176 128 176 162 C176 196 150 210 120 210 C90 210 64 196 64 162 C64 128 80 88 120 88 Z",
  },
  machop: {
    id: "machop", number: 66, name: "Machop", paint: "species", color: "#a8b8c8", accent: "#7f8fa0",
    parts: [
      { fill: "body", d: "M120 92 C158 92 172 128 172 158 C172 190 148 204 120 204 C92 204 68 190 68 158 C68 128 82 92 120 92 Z" },
      { fill: "accent", d: "M86 140 C66 140 62 164 78 172 Z" },
      { fill: "accent", d: "M154 140 C174 140 178 164 162 172 Z" },
      { fill: "accent", d: "M120 96 C110 82 112 64 124 56 C128 72 130 86 128 96 Z" },
    ],
    eyes: face(120, 138, 32, 28), clip: "M120 92 C158 92 172 128 172 158 C172 190 148 204 120 204 C92 204 68 190 68 158 C68 128 82 92 120 92 Z",
  },
  machoke: {
    id: "machoke", number: 67, name: "Machoke", paint: "species", color: "#96a8bc", accent: "#6f8296",
    parts: [
      { fill: "body", d: "M120 88 C160 88 176 128 176 160 C176 194 150 208 120 208 C90 208 64 194 64 160 C64 128 80 88 120 88 Z" },
      { fill: "accent", d: "M82 136 C58 136 54 166 74 174 Z" },
      { fill: "accent", d: "M158 136 C182 136 186 166 166 174 Z" },
      { fill: "accent", d: "M120 94 C108 78 110 58 124 50 C128 68 130 84 128 94 Z" },
    ],
    eyes: face(120, 136, 34, 28), clip: "M120 88 C160 88 176 128 176 160 C176 194 150 208 120 208 C90 208 64 194 64 160 C64 128 80 88 120 88 Z",
  },
  machamp: {
    id: "machamp", number: 68, name: "Machamp", paint: "species", color: "#8c9fb4", accent: "#64778c",
    parts: [
      { fill: "body", d: "M120 84 C162 84 178 126 178 160 C178 196 152 210 120 210 C88 210 62 196 62 160 C62 126 78 84 120 84 Z" },
      { fill: "accent", d: "M40 130 L64 138 L58 162 L36 154 Z" },
      { fill: "accent", d: "M200 130 L176 138 L182 162 L204 154 Z" },
      { fill: "accent", d: "M120 90 C108 74 110 52 124 44 C128 62 130 80 128 90 Z" },
    ],
    eyes: face(120, 134, 34, 28), clip: "M120 84 C162 84 178 126 178 160 C178 196 152 210 120 210 C88 210 62 196 62 160 C62 126 78 84 120 84 Z",
  },
  bellsprout: {
    id: "bellsprout", number: 69, name: "Bellsprout", paint: "species", color: "#e0c85a", accent: "#6fa84a",
    parts: [
      { fill: "accent", d: "M118 126 C104 126 96 108 100 92 C106 100 116 110 122 116 Z" },
      { fill: "accent", d: "M122 126 C136 126 144 108 140 92 C134 100 124 110 118 116 Z" },
      { fill: "body", d: "M120 122 C144 122 154 148 154 172 C154 194 140 204 120 204 C100 204 86 194 86 172 C86 148 96 122 120 122 Z" },
      { fill: "accent", d: "M104 204 C96 216 100 226 112 228 M136 204 C144 216 140 226 128 228" },
    ],
    eyes: face(120, 162, 26, 26), clip: "M120 122 C144 122 154 148 154 172 C154 194 140 204 120 204 C100 204 86 194 86 172 C86 148 96 122 120 122 Z",
  },
  weepinbell: {
    id: "weepinbell", number: 70, name: "Weepinbell", paint: "species", color: "#d4bc48", accent: "#6fa84a",
    parts: [
      { fill: "accent", d: "M120 104 C104 104 94 84 98 66 C106 76 114 90 120 98 Z" },
      { fill: "accent", d: "M120 104 C136 104 146 84 142 66 C134 76 126 90 120 98 Z" },
      { fill: "body", d: "M120 96 C150 96 164 128 164 156 C164 186 146 200 120 200 C94 200 76 186 76 156 C76 128 90 96 120 96 Z" },
    ],
    eyes: face(120, 148, 30, 26), clip: "M120 96 C150 96 164 128 164 156 C164 186 146 200 120 200 C94 200 76 186 76 156 C76 128 90 96 120 96 Z",
  },
  victreebel: {
    id: "victreebel", number: 71, name: "Victreebel", paint: "species", color: "#c4a83e", accent: "#5f9838",
    parts: [
      { fill: "accent", d: "M120 90 C96 90 82 62 100 48 C110 40 130 40 140 48 C158 62 144 90 120 90 Z" },
      { fill: "body", d: "M120 94 C154 94 172 128 172 160 C172 192 150 206 120 206 C90 206 68 192 68 160 C68 128 86 94 120 94 Z" },
      { fill: "accent", d: "M120 152 C138 152 144 168 134 178 C124 186 112 184 106 174 C100 160 108 152 120 152 Z" },
    ],
    eyes: face(120, 146, 32, 26), clip: "M120 94 C154 94 172 128 172 160 C172 192 150 206 120 206 C90 206 68 192 68 160 C68 128 86 94 120 94 Z",
  },
  tentacool: {
    id: "tentacool", number: 72, name: "Tentacool", paint: "species", color: "#5aa8cc", accent: "#d0484a",
    parts: [
      { fill: "body", d: "M120 80 C152 80 168 112 168 140 C168 162 148 174 120 174 C92 174 72 162 72 140 C72 112 88 80 120 80 Z" },
      { fill: "accent", d: "M96 174 C90 192 94 206 104 210 M120 174 C120 194 120 206 120 212 M144 174 C150 192 146 206 136 210" },
      { fill: "accent", d: "M120 84 C114 96 114 108 120 116 C126 108 126 96 120 84 Z" },
    ],
    eyes: face(120, 134, 30, 26), clip: "M120 80 C152 80 168 112 168 140 C168 162 148 174 120 174 C92 174 72 162 72 140 C72 112 88 80 120 80 Z",
  },
  tentacruel: {
    id: "tentacruel", number: 73, name: "Tentacruel", paint: "species", color: "#4a90b8", accent: "#c04050",
    parts: [
      { fill: "body", d: "M120 72 C158 72 176 110 176 142 C176 168 152 180 120 180 C88 180 64 168 64 142 C64 110 82 72 120 72 Z" },
      { fill: "accent", d: "M88 180 C80 200 84 214 96 218 M106 180 C104 202 108 214 114 220 M134 180 C136 202 132 214 126 220 M152 180 C160 200 156 214 144 218" },
      { fill: "accent", d: "M120 76 L104 56 L136 56 Z" },
    ],
    eyes: face(120, 132, 34, 26), clip: "M120 72 C158 72 176 110 176 142 C176 168 152 180 120 180 C88 180 64 168 64 142 C64 110 82 72 120 72 Z",
  },
  geodude: {
    id: "geodude", number: 74, name: "Geodude", paint: "species", color: "#9a94a0", accent: "#6f6a76",
    parts: [
      { fill: "body", d: "M120 88 C154 88 174 118 174 148 C174 178 152 194 120 194 C88 194 66 178 66 148 C66 118 86 88 120 88 Z" },
      { fill: "accent", d: "M46 158 C34 158 30 176 42 182 C54 186 60 172 54 164 Z" },
      { fill: "accent", d: "M194 158 C206 158 210 176 198 182 C186 186 180 172 186 164 Z" },
      { fill: "accent", d: "M96 94 L86 74 L106 84 Z" },
    ],
    eyes: face(120, 140, 32, 28), clip: "M120 88 C154 88 174 118 174 148 C174 178 152 194 120 194 C88 194 66 178 66 148 C66 118 86 88 120 88 Z",
  },
  graveler: {
    id: "graveler", number: 75, name: "Graveler", paint: "species", color: "#8b8593", accent: "#615c68",
    parts: [
      { fill: "body", d: "M120 82 C158 82 180 116 180 150 C180 184 154 200 120 200 C86 200 60 184 60 150 C60 116 82 82 120 82 Z" },
      { fill: "accent", d: "M38 156 C24 156 20 178 34 184 C48 188 54 172 48 162 Z" },
      { fill: "accent", d: "M202 156 C216 156 220 178 206 184 C192 188 186 172 192 162 Z" },
      { fill: "accent", d: "M92 92 L80 68 L104 80 Z" },
    ],
    eyes: face(120, 138, 34, 26), clip: "M120 82 C158 82 180 116 180 150 C180 184 154 200 120 200 C86 200 60 184 60 150 C60 116 82 82 120 82 Z",
  },
  golem: {
    id: "golem", number: 76, name: "Golem", paint: "species", color: "#7c7686", accent: "#544f5e",
    parts: [
      { fill: "body", d: "M120 76 C162 76 186 114 186 150 C186 188 156 204 120 204 C84 204 54 188 54 150 C54 114 78 76 120 76 Z" },
      { fill: "accent", d: "M32 150 C16 150 12 176 28 182 C44 186 50 168 44 158 Z" },
      { fill: "accent", d: "M208 150 C224 150 228 176 212 182 C196 186 190 168 196 158 Z" },
      { fill: "accent", d: "M120 80 C108 62 112 40 126 32 C130 52 132 70 130 80 Z" },
    ],
    eyes: face(120, 136, 36, 26), clip: "M120 76 C162 76 186 114 186 150 C186 188 156 204 120 204 C84 204 54 188 54 150 C54 114 78 76 120 76 Z",
  },
  ponyta: {
    id: "ponyta", number: 77, name: "Ponyta", paint: "species", color: "#f0e8d8", accent: "#f08a3a",
    parts: [
      { fill: "accent", d: "M96 106 C74 84 70 52 88 38 C94 64 100 88 110 102 Z" },
      { fill: "body", d: "M120 92 C156 92 172 128 172 158 C172 190 150 204 120 204 C90 204 68 190 68 158 C68 128 84 92 120 92 Z" },
      { fill: "accent", d: "M152 156 C176 148 190 158 190 176 C190 190 176 196 164 190 C156 186 152 176 156 168 Z" },
    ],
    eyes: face(120, 140, 32, 30), clip: "M120 92 C156 92 172 128 172 158 C172 190 150 204 120 204 C90 204 68 190 68 158 C68 128 84 92 120 92 Z",
  },
  rapidash: {
    id: "rapidash", number: 78, name: "Rapidash", paint: "species", color: "#ece0cc", accent: "#f0783a",
    parts: [
      { fill: "accent", d: "M94 104 C68 82 62 46 84 32 C90 60 98 88 110 100 Z" },
      { fill: "accent", d: "M120 96 C104 72 106 44 120 30 C134 44 136 72 120 96 Z" },
      { fill: "body", d: "M120 90 C158 90 174 128 174 160 C174 192 150 206 120 206 C90 206 66 192 66 160 C66 128 82 90 120 90 Z" },
      { fill: "accent", d: "M154 154 C180 146 194 158 192 178 C190 192 174 196 164 188 Z" },
    ],
    eyes: face(120, 140, 32, 28), clip: "M120 90 C158 90 174 128 174 160 C174 192 150 206 120 206 C90 206 66 192 66 160 C66 128 82 90 120 90 Z",
  },
  slowpoke: {
    id: "slowpoke", number: 79, name: "Slowpoke", paint: "species", color: "#f0b6c0", accent: "#c88a96",
    parts: [
      { fill: "accent", d: "M84 108 C70 90 72 66 86 58 C90 78 96 96 106 104 Z" },
      { fill: "accent", d: "M156 108 C170 90 168 66 154 58 C150 78 144 96 134 104 Z" },
      { fill: "body", d: "M120 94 C160 94 178 130 178 162 C178 194 152 208 120 208 C88 208 62 194 62 162 C62 130 80 94 120 94 Z" },
    ],
    eyes: face(120, 140, 34, 28), clip: "M120 94 C160 94 178 130 178 162 C178 194 152 208 120 208 C88 208 62 194 62 162 C62 130 80 94 120 94 Z",
  },
  slowbro: {
    id: "slowbro", number: 80, name: "Slowbro", paint: "species", color: "#e8a6b2", accent: "#a87f8a",
    parts: [
      { fill: "accent", d: "M120 46 C146 46 160 66 156 88 C146 78 136 72 120 72 C104 72 94 78 84 88 C80 66 94 46 120 46 Z" },
      { fill: "body", d: "M120 94 C162 94 180 130 180 162 C180 196 152 210 120 210 C88 210 60 196 60 162 C60 130 78 94 120 94 Z" },
      { fill: "accent", d: "M60 150 C40 150 36 176 52 184 Z" },
      { fill: "accent", d: "M180 150 C200 150 204 176 188 184 Z" },
    ],
    eyes: face(120, 142, 34, 28), clip: "M120 94 C162 94 180 130 180 162 C180 196 152 210 120 210 C88 210 60 196 60 162 C60 130 78 94 120 94 Z",
  },
  magnemite: {
    id: "magnemite", number: 81, name: "Magnemite", paint: "species", color: "#b8bcc8", accent: "#8a8f9c",
    parts: [
      { fill: "body", d: "M120 108 C146 108 160 130 160 152 C160 178 142 190 120 190 C98 190 80 178 80 152 C80 130 94 108 120 108 Z" },
      { fill: "accent", d: "M120 108 L96 76 L120 88 L144 76 Z" },
      { fill: "accent", d: "M120 96 L120 62" },
    ],
    eyes: face(120, 146, 26, 28), clip: "M120 108 C146 108 160 130 160 152 C160 178 142 190 120 190 C98 190 80 178 80 152 C80 130 94 108 120 108 Z",
  },
  magneton: {
    id: "magneton", number: 82, name: "Magneton", paint: "species", color: "#a8adbc", accent: "#7f8494",
    parts: [
      { fill: "accent", d: "M72 132 C58 132 50 148 50 160 C50 174 60 182 72 182 C84 182 94 174 94 160 C94 148 86 132 72 132 Z" },
      { fill: "accent", d: "M168 132 C182 132 190 148 190 160 C190 174 180 182 168 182 C156 182 146 174 146 160 C146 148 154 132 168 132 Z" },
      { fill: "body", d: "M120 100 C148 100 164 126 164 152 C164 180 144 194 120 194 C96 194 76 180 76 152 C76 126 92 100 120 100 Z" },
      { fill: "accent", d: "M120 104 L100 74 L120 86 L140 74 Z" },
    ],
    eyes: face(120, 146, 28, 26), clip: "M120 100 C148 100 164 126 164 152 C164 180 144 194 120 194 C96 194 76 180 76 152 C76 126 92 100 120 100 Z",
  },
  farfetchd: {
    id: "farfetchd", number: 83, name: "Farfetch'd", paint: "species", color: "#d4a45a", accent: "#6fa84a",
    parts: [
      { fill: "accent", d: "M120 100 C100 92 92 68 104 54 C112 70 116 88 120 98 Z" },
      { fill: "body", d: "M120 96 C156 96 172 130 172 158 C172 190 150 204 120 204 C90 204 68 190 68 158 C68 130 84 96 120 96 Z" },
      { fill: "accent", d: "M164 150 C186 140 196 152 190 172 C184 186 168 186 162 174 Z" },
    ],
    eyes: face(120, 144, 32, 28), clip: "M120 96 C156 96 172 130 172 158 C172 190 150 204 120 204 C90 204 68 190 68 158 C68 130 84 96 120 96 Z",
  },
  doduo: {
    id: "doduo", number: 84, name: "Doduo", paint: "species", color: "#d0a878", accent: "#a07a4c",
    parts: [
      { fill: "accent", d: "M88 108 C76 88 80 64 94 56 C98 76 102 94 108 104 Z" },
      { fill: "accent", d: "M130 108 C142 88 138 64 124 56 C120 76 116 94 110 104 Z" },
      { fill: "body", d: "M120 96 C152 96 166 130 166 158 C166 190 146 204 120 204 C94 204 74 190 74 158 C74 130 88 96 120 96 Z" },
    ],
    eyes: face(120, 144, 26, 28), clip: "M120 96 C152 96 166 130 166 158 C166 190 146 204 120 204 C94 204 74 190 74 158 C74 130 88 96 120 96 Z",
  },
  dodrio: {
    id: "dodrio", number: 85, name: "Dodrio", paint: "species", color: "#c49a6b", accent: "#8f6a40",
    parts: [
      { fill: "accent", d: "M84 104 C70 84 74 56 90 48 C94 70 98 90 106 100 Z" },
      { fill: "accent", d: "M120 96 C108 74 112 44 128 34 C132 58 134 82 130 94 Z" },
      { fill: "accent", d: "M156 104 C170 84 166 56 150 48 C146 70 142 90 134 100 Z" },
      { fill: "body", d: "M120 94 C156 94 172 130 172 160 C172 192 150 206 120 206 C90 206 68 192 68 160 C68 130 84 94 120 94 Z" },
    ],
    eyes: face(120, 142, 30, 26), clip: "M120 94 C156 94 172 130 172 160 C172 192 150 206 120 206 C90 206 68 192 68 160 C68 130 84 94 120 94 Z",
  },
  seel: {
    id: "seel", number: 86, name: "Seel", paint: "species", color: "#e8e4f0", accent: "#b8b0c8",
    parts: [
      { fill: "accent", d: "M120 100 L106 74 L120 84 L134 74 Z" },
      { fill: "body", d: "M120 96 C158 96 176 132 176 162 C176 194 150 208 120 208 C90 208 64 194 64 162 C64 132 82 96 120 96 Z" },
      { fill: "accent", d: "M120 148 C132 148 138 158 132 166 C126 172 114 172 108 166 C102 158 108 148 120 148 Z" },
    ],
    eyes: face(120, 140, 32, 28), clip: "M120 96 C158 96 176 132 176 162 C176 194 150 208 120 208 C90 208 64 194 64 162 C64 132 82 96 120 96 Z",
  },
  dewgong: {
    id: "dewgong", number: 87, name: "Dewgong", paint: "species", color: "#e2dcea", accent: "#a8a0bc",
    parts: [
      { fill: "accent", d: "M120 90 C104 68 106 42 120 30 C134 42 136 68 120 90 Z" },
      { fill: "body", d: "M120 92 C160 92 178 130 178 162 C178 196 152 210 120 210 C88 210 62 196 62 162 C62 130 80 92 120 92 Z" },
      { fill: "accent", d: "M120 144 C134 144 140 156 134 166 C128 174 112 174 106 166 C100 156 106 144 120 144 Z" },
    ],
    eyes: face(120, 138, 34, 28), clip: "M120 92 C160 92 178 130 178 162 C178 196 152 210 120 210 C88 210 62 196 62 162 C62 130 80 92 120 92 Z",
  },
  grimer: {
    id: "grimer", number: 88, name: "Grimer", paint: "species", color: "#a47ac8", accent: "#7f5aa8",
    parts: [
      { fill: "body", d: "M120 88 C160 88 182 124 182 156 C182 186 156 200 120 200 C84 200 58 186 58 156 C58 124 80 88 120 88 Z" },
      { fill: "accent", d: "M90 100 C78 82 84 62 98 56 C100 74 100 90 104 100 Z" },
      { fill: "accent", d: "M150 100 C162 82 156 62 142 56 C140 74 140 90 136 100 Z" },
    ],
    eyes: face(120, 140, 32, 28), clip: "M120 88 C160 88 182 124 182 156 C182 186 156 200 120 200 C84 200 58 186 58 156 C58 124 80 88 120 88 Z",
  },
  muk: {
    id: "muk", number: 89, name: "Muk", paint: "species", color: "#9470b8", accent: "#6f4f96",
    parts: [
      { fill: "body", d: "M120 82 C164 82 188 122 188 156 C188 190 158 206 120 206 C82 206 52 190 52 156 C52 122 76 82 120 82 Z" },
      { fill: "accent", d: "M80 94 C64 74 72 50 88 44 C90 66 92 84 96 94 Z" },
      { fill: "accent", d: "M160 94 C176 74 168 50 152 44 C150 66 148 84 144 94 Z" },
      { fill: "accent", d: "M52 168 C36 176 34 194 50 198 Z" },
    ],
    eyes: face(120, 138, 36, 26), clip: "M120 82 C164 82 188 122 188 156 C188 190 158 206 120 206 C82 206 52 190 52 156 C52 122 76 82 120 82 Z",
  },
  shellder: {
    id: "shellder", number: 90, name: "Shellder", paint: "species", color: "#9c7ac0", accent: "#e8e0f0",
    parts: [
      { fill: "body", d: "M120 96 C158 96 178 130 178 158 C178 188 152 202 120 202 C88 202 62 188 62 158 C62 130 82 96 120 96 Z" },
      { fill: "accent", d: "M120 96 C104 78 106 54 120 44 C134 54 136 78 120 96 Z" },
      { fill: "accent", d: "M74 148 C56 148 52 170 68 176 Z" },
      { fill: "accent", d: "M166 148 C184 148 188 170 172 176 Z" },
    ],
    eyes: face(120, 144, 32, 28), clip: "M120 96 C158 96 178 130 178 158 C178 188 152 202 120 202 C88 202 62 188 62 158 C62 130 82 96 120 96 Z",
  },
  cloyster: {
    id: "cloyster", number: 91, name: "Cloyster", paint: "species", color: "#8c6ab0", accent: "#d8cfe8",
    parts: [
      { fill: "body", d: "M120 90 C162 90 184 126 184 158 C184 192 156 208 120 208 C84 208 56 192 56 158 C56 126 78 90 120 90 Z" },
      { fill: "accent", d: "M120 94 L100 58 L120 74 L140 58 Z" },
      { fill: "accent", d: "M66 132 L40 120 L60 150 Z" },
      { fill: "accent", d: "M174 132 L200 120 L180 150 Z" },
    ],
    eyes: face(120, 144, 34, 26), clip: "M120 90 C162 90 184 126 184 158 C184 192 156 208 120 208 C84 208 56 192 56 158 C56 126 78 90 120 90 Z",
  },
  gastly: {
    id: "gastly", number: 92, name: "Gastly", paint: "species", color: "#6a5a88", accent: "#4a3c66",
    parts: [
      { fill: "body", d: "M120 84 C158 84 180 120 180 152 C180 186 154 200 120 200 C86 200 60 186 60 152 C60 120 82 84 120 84 Z" },
      { fill: "accent", d: "M78 118 C60 110 52 128 62 142 Z" },
      { fill: "accent", d: "M162 118 C180 110 188 128 178 142 Z" },
      { fill: "accent", d: "M96 190 C88 206 96 214 108 210 M144 190 C152 206 144 214 132 210" },
    ],
    eyes: face(120, 146, 34, 28), clip: "M120 84 C158 84 180 120 180 152 C180 186 154 200 120 200 C86 200 60 186 60 152 C60 120 82 84 120 84 Z",
  },
  haunter: {
    id: "haunter", number: 93, name: "Haunter", paint: "species", color: "#7a5a98", accent: "#5a3f78",
    parts: [
      { fill: "body", d: "M120 80 C162 80 186 118 186 152 C186 188 156 202 120 202 C84 202 54 188 54 152 C54 118 78 80 120 80 Z" },
      { fill: "accent", d: "M88 92 C70 78 68 54 84 46 C88 66 94 82 100 90 Z" },
      { fill: "accent", d: "M152 92 C170 78 172 54 156 46 C152 66 146 82 140 90 Z" },
      { fill: "accent", d: "M120 150 C136 150 142 164 132 172 C122 178 110 176 106 166 C102 154 110 150 120 150 Z" },
    ],
    eyes: face(120, 134, 36, 26), clip: "M120 80 C162 80 186 118 186 152 C186 188 156 202 120 202 C84 202 54 188 54 152 C54 118 78 80 120 80 Z",
  },
  gengar: {
    id: "gengar", number: 94, name: "Gengar", paint: "species", color: "#7a5aa8", accent: "#ff7a5a",
    parts: [
      { fill: "body", d: "M120 74 C166 74 190 116 190 154 C190 192 158 208 120 208 C82 208 50 192 50 154 C50 116 74 74 120 74 Z" },
      { fill: "accent", d: "M86 88 C66 74 66 46 84 38 C88 60 94 78 100 88 Z" },
      { fill: "accent", d: "M154 88 C174 74 174 46 156 38 C152 60 146 78 140 88 Z" },
      { fill: "accent", d: "M120 148 C140 148 146 166 134 176 C122 184 108 182 102 170 C96 156 108 148 120 148 Z" },
    ],
    eyes: face(120, 132, 38, 26), clip: "M120 74 C166 74 190 116 190 154 C190 192 158 208 120 208 C82 208 50 192 50 154 C50 116 74 74 120 74 Z",
  },
  onix: {
    id: "onix", number: 95, name: "Onix", paint: "species", color: "#a8a0a8", accent: "#7f7780",
    parts: [
      { fill: "accent", d: "M60 206 C46 190 54 172 74 172 C88 172 96 184 92 196 C88 208 70 214 60 206 Z" },
      { fill: "body", d: "M72 178 C64 150 76 130 100 126 C124 122 140 136 148 156 C154 172 146 184 132 184 C122 184 118 172 124 162 C130 150 122 142 110 146 C96 152 92 166 100 176 C106 186 96 196 86 192 Z" },
      { fill: "body", d: "M120 62 C158 62 176 98 176 134 C176 166 152 180 120 180 C88 180 64 166 64 134 C64 98 82 62 120 62 Z" },
      { fill: "accent", d: "M120 66 L104 42 L136 42 Z" },
    ],
    eyes: face(120, 120, 34, 26), clip: "M120 62 C158 62 176 98 176 134 C176 166 152 180 120 180 C88 180 64 166 64 134 C64 98 82 62 120 62 Z",
  },
  drowzee: {
    id: "drowzee", number: 96, name: "Drowzee", paint: "species", color: "#e0b88c", accent: "#a88660",
    parts: [
      { fill: "accent", d: "M120 92 C104 72 106 46 120 36 C134 46 136 72 120 92 Z" },
      { fill: "body", d: "M120 90 C158 90 176 128 176 160 C176 192 150 206 120 206 C90 206 64 192 64 160 C64 128 82 90 120 90 Z" },
      { fill: "accent", d: "M120 146 C134 146 140 158 132 166 C124 172 114 172 108 166 C100 158 106 146 120 146 Z" },
    ],
    eyes: face(120, 138, 32, 28), clip: "M120 90 C158 90 176 128 176 160 C176 192 150 206 120 206 C90 206 64 192 64 160 C64 128 82 90 120 90 Z",
  },
  hypno: {
    id: "hypno", number: 97, name: "Hypno", paint: "species", color: "#d4a878", accent: "#a07a50",
    parts: [
      { fill: "accent", d: "M120 90 C102 70 104 42 120 30 C136 42 138 70 120 90 Z" },
      { fill: "body", d: "M120 88 C160 88 178 128 178 162 C178 194 152 208 120 208 C88 208 62 194 62 162 C62 128 80 88 120 88 Z" },
      { fill: "accent", d: "M120 146 C136 146 142 160 134 168 C126 174 112 174 106 166 C98 156 106 146 120 146 Z" },
    ],
    eyes: face(120, 136, 34, 26), clip: "M120 88 C160 88 178 128 178 162 C178 194 152 208 120 208 C88 208 62 194 62 162 C62 128 80 88 120 88 Z",
  },
  krabby: {
    id: "krabby", number: 98, name: "Krabby", paint: "species", color: "#e08a5a", accent: "#c85a3a",
    parts: [
      { fill: "accent", d: "M62 138 C40 130 36 152 52 162 C64 168 74 158 70 146 Z" },
      { fill: "accent", d: "M178 138 C200 130 204 152 188 162 C176 168 166 158 170 146 Z" },
      { fill: "body", d: "M120 96 C154 96 170 128 170 158 C170 188 148 202 120 202 C92 202 70 188 70 158 C70 128 86 96 120 96 Z" },
      { fill: "accent", d: "M104 96 L96 74 L112 90 Z" },
      { fill: "accent", d: "M136 96 L144 74 L128 90 Z" },
    ],
    eyes: face(120, 142, 30, 26), clip: "M120 96 C154 96 170 128 170 158 C170 188 148 202 120 202 C92 202 70 188 70 158 C70 128 86 96 120 96 Z",
  },
  kingler: {
    id: "kingler", number: 99, name: "Kingler", paint: "species", color: "#d0744a", accent: "#b84a30",
    parts: [
      { fill: "accent", d: "M52 134 C26 126 22 156 42 168 C58 176 70 162 64 148 Z" },
      { fill: "accent", d: "M188 134 C214 126 218 156 198 168 C182 176 170 162 176 148 Z" },
      { fill: "body", d: "M120 92 C158 92 176 128 176 160 C176 194 150 208 120 208 C90 208 64 194 64 160 C64 128 82 92 120 92 Z" },
      { fill: "accent", d: "M120 96 L106 66 L134 66 Z" },
    ],
    eyes: face(120, 138, 34, 26), clip: "M120 92 C158 92 176 128 176 160 C176 194 150 208 120 208 C90 208 64 194 64 160 C64 128 82 92 120 92 Z",
  },
  voltorb: {
    id: "voltorb", number: 100, name: "Voltorb", paint: "species", color: "#e05858", accent: "#f0f0f0",
    parts: [
      { fill: "body", d: "M120 78 C158 78 178 114 178 152 C178 190 154 206 120 206 C86 206 62 190 62 152 C62 114 82 78 120 78 Z" },
      { fill: "accent", d: "M120 84 C104 100 96 124 96 148 C96 172 104 192 120 200 Z" },
      { fill: "accent", d: "M62 152 C86 142 154 142 178 152" },
    ],
    eyes: face(120, 140, 34, 30), clip: "M120 78 C158 78 178 114 178 152 C178 190 154 206 120 206 C86 206 62 190 62 152 C62 114 82 78 120 78 Z",
  },
  electrode: {
    id: "electrode", number: 101, name: "Electrode", paint: "species", color: "#d84a4a", accent: "#f0f0f0",
    parts: [
      { fill: "body", d: "M120 70 C162 70 186 112 186 150 C186 192 158 210 120 210 C82 210 54 192 54 150 C54 112 78 70 120 70 Z" },
      { fill: "accent", d: "M120 78 C100 96 90 122 90 148 C90 176 102 196 120 204 Z" },
      { fill: "accent", d: "M54 150 C82 138 158 138 186 150" },
    ],
    eyes: face(120, 138, 36, 28), clip: "M120 70 C162 70 186 112 186 150 C186 192 158 210 120 210 C82 210 54 192 54 150 C54 112 78 70 120 70 Z",
  },
  exeggcute: {
    id: "exeggcute", number: 102, name: "Exeggcute", paint: "species", color: "#f0d8a8", accent: "#d8b878",
    parts: [
      { fill: "accent", d: "M64 150 C44 150 40 176 58 182 C74 186 80 168 74 158 Z" },
      { fill: "accent", d: "M176 150 C196 150 200 176 182 182 C166 186 160 168 166 158 Z" },
      { fill: "accent", d: "M120 118 C104 118 96 138 102 152 C110 162 130 162 138 152 C144 138 136 118 120 118 Z" },
      { fill: "body", d: "M120 96 C156 96 172 130 172 160 C172 192 148 206 120 206 C92 206 68 192 68 160 C68 130 84 96 120 96 Z" },
    ],
    eyes: face(120, 144, 32, 26), clip: "M120 96 C156 96 172 130 172 160 C172 192 148 206 120 206 C92 206 68 192 68 160 C68 130 84 96 120 96 Z",
  },
  exeggutor: {
    id: "exeggutor", number: 103, name: "Exeggutor", paint: "species", color: "#e8cc94", accent: "#6fa84a",
    parts: [
      { fill: "accent", d: "M120 92 C92 92 76 66 96 50 C110 40 130 40 144 50 C164 66 148 92 120 92 Z" },
      { fill: "body", d: "M120 88 C160 88 180 126 180 162 C180 196 152 210 120 210 C88 210 60 196 60 162 C60 126 80 88 120 88 Z" },
      { fill: "accent", d: "M60 150 C38 150 34 178 52 186 Z" },
      { fill: "accent", d: "M180 150 C202 150 206 178 188 186 Z" },
    ],
    eyes: face(120, 142, 34, 26), clip: "M120 88 C160 88 180 126 180 162 C180 196 152 210 120 210 C88 210 60 196 60 162 C60 126 80 88 120 88 Z",
  },
  cubone: {
    id: "cubone", number: 104, name: "Cubone", paint: "species", color: "#d8b878", accent: "#e8e4d8",
    parts: [
      { fill: "accent", d: "M120 78 C152 78 172 106 172 134 C172 154 158 166 140 168 C132 168 126 158 130 146 C134 132 132 120 120 120 C108 120 106 132 110 146 C114 158 108 168 100 168 C82 166 68 154 68 134 C68 106 88 78 120 78 Z" },
      { fill: "body", d: "M120 160 C156 160 174 190 174 214 L66 214 C66 190 84 160 120 160 Z" },
    ],
    eyes: face(120, 196, 26, 20), clip: "M120 160 C156 160 174 190 174 214 L66 214 C66 190 84 160 120 160 Z",
  },
  marowak: {
    id: "marowak", number: 105, name: "Marowak", paint: "species", color: "#cba868", accent: "#e0dcd0",
    parts: [
      { fill: "accent", d: "M120 72 C156 72 178 104 178 136 C178 158 162 172 142 172 C132 172 126 160 132 146 C136 132 132 118 120 118 C108 118 104 132 108 146 C114 160 108 172 98 172 C78 172 62 158 62 136 C62 104 84 72 120 72 Z" },
      { fill: "body", d: "M120 158 C158 158 178 190 178 216 L62 216 C62 190 82 158 120 158 Z" },
      { fill: "accent", d: "M186 120 L204 96 L200 140 Z" },
    ],
    eyes: face(120, 196, 28, 18), clip: "M120 158 C158 158 178 190 178 216 L62 216 C62 190 82 158 120 158 Z",
  },
  hitmonlee: {
    id: "hitmonlee", number: 106, name: "Hitmonlee", paint: "species", color: "#d8b4a0", accent: "#a88868",
    parts: [
      { fill: "body", d: "M120 94 C154 94 170 126 170 154 C170 184 148 198 120 198 C92 198 70 184 70 154 C70 126 86 94 120 94 Z" },
      { fill: "accent", d: "M96 198 C88 216 90 226 100 228 M144 198 C152 216 150 226 140 228" },
      { fill: "accent", d: "M70 140 C50 136 44 156 60 164 Z" },
      { fill: "accent", d: "M170 140 C190 136 196 156 180 164 Z" },
    ],
    eyes: face(120, 140, 32, 26), clip: "M120 94 C154 94 170 126 170 154 C170 184 148 198 120 198 C92 198 70 184 70 154 C70 126 86 94 120 94 Z",
  },
  hitmonchan: {
    id: "hitmonchan", number: 107, name: "Hitmonchan", paint: "species", color: "#c8a48c", accent: "#e05a5a",
    parts: [
      { fill: "body", d: "M120 90 C156 90 174 124 174 154 C174 186 150 200 120 200 C90 200 66 186 66 154 C66 124 84 90 120 90 Z" },
      { fill: "accent", d: "M58 128 C38 128 34 152 52 158 C64 162 72 148 68 138 Z" },
      { fill: "accent", d: "M182 128 C202 128 206 152 188 158 C176 162 168 148 172 138 Z" },
      { fill: "accent", d: "M120 94 C110 80 112 62 124 54 C128 70 130 84 128 94 Z" },
    ],
    eyes: face(120, 138, 34, 26), clip: "M120 90 C156 90 174 124 174 154 C174 186 150 200 120 200 C90 200 66 186 66 154 C66 124 84 90 120 90 Z",
  },
  lickitung: {
    id: "lickitung", number: 108, name: "Lickitung", paint: "species", color: "#f0b6c8", accent: "#d890a8",
    parts: [
      { fill: "body", d: "M120 88 C160 88 180 126 180 160 C180 192 152 206 120 206 C88 206 60 192 60 160 C60 126 80 88 120 88 Z" },
      { fill: "accent", d: "M120 146 C140 146 148 164 136 176 C124 186 108 182 102 168 C98 152 110 146 120 146 Z" },
      { fill: "accent", d: "M74 100 C60 80 66 58 82 52 C84 72 84 88 88 98 Z" },
      { fill: "accent", d: "M166 100 C180 80 174 58 158 52 C156 72 156 88 152 98 Z" },
    ],
    eyes: face(120, 138, 34, 26), clip: "M120 88 C160 88 180 126 180 160 C180 192 152 206 120 206 C88 206 60 192 60 160 C60 126 80 88 120 88 Z",
  },
  koffing: {
    id: "koffing", number: 109, name: "Koffing", paint: "species", color: "#a07ab8", accent: "#7f5a98",
    parts: [
      { fill: "body", d: "M120 70 C162 70 186 112 186 154 C186 194 158 212 120 212 C82 212 54 194 54 154 C54 112 78 70 120 70 Z" },
      { fill: "accent", d: "M120 78 C104 78 98 96 106 108 C114 116 128 116 134 106 C140 94 134 78 120 78 Z" },
      { fill: "accent", d: "M70 126 C56 116 44 126 50 140 Z" },
      { fill: "accent", d: "M170 126 C184 116 196 126 190 140 Z" },
    ],
    eyes: face(120, 148, 36, 26), clip: "M120 70 C162 70 186 112 186 154 C186 194 158 212 120 212 C82 212 54 194 54 154 C54 112 78 70 120 70 Z",
  },
  weezing: {
    id: "weezing", number: 110, name: "Weezing", paint: "species", color: "#9470ac", accent: "#6f5090",
    parts: [
      { fill: "accent", d: "M64 128 C42 128 34 156 48 172 C62 186 84 178 86 158 C88 138 80 128 64 128 Z" },
      { fill: "accent", d: "M176 128 C198 128 206 156 192 172 C178 186 156 178 154 158 C152 138 160 128 176 128 Z" },
      { fill: "body", d: "M120 80 C160 80 182 118 182 154 C182 192 154 210 120 210 C86 210 58 192 58 154 C58 118 80 80 120 80 Z" },
      { fill: "accent", d: "M120 88 C106 88 100 104 108 114 C116 122 128 122 134 112 C140 100 134 88 120 88 Z" },
    ],
    eyes: face(120, 148, 38, 26), clip: "M120 80 C160 80 182 118 182 154 C182 192 154 210 120 210 C86 210 58 192 58 154 C58 118 80 80 120 80 Z",
  },
  rhyhorn: {
    id: "rhyhorn", number: 111, name: "Rhyhorn", paint: "species", color: "#b0a8b8", accent: "#8a8290",
    parts: [
      { fill: "body", d: "M64 194 C54 158 64 120 120 108 C176 120 186 158 176 194 C166 208 74 208 64 194 Z" },
      { fill: "accent", d: "M120 112 L120 84 L136 96 Z" },
      { fill: "accent", d: "M78 132 L62 112 L86 118 Z" },
      { fill: "accent", d: "M162 132 L178 112 L154 118 Z" },
    ],
    eyes: face(120, 152, 32, 28), clip: "M64 194 C54 158 64 120 120 108 C176 120 186 158 176 194 C166 208 74 208 64 194 Z",
  },
  rhydon: {
    id: "rhydon", number: 112, name: "Rhydon", paint: "species", color: "#a29aab", accent: "#78707e",
    parts: [
      { fill: "body", d: "M60 196 C50 158 60 116 120 104 C180 116 190 158 180 196 C170 210 70 210 60 196 Z" },
      { fill: "accent", d: "M120 108 L120 74 L142 90 Z" },
      { fill: "accent", d: "M74 128 L54 104 L82 112 Z" },
      { fill: "accent", d: "M166 128 L186 104 L158 112 Z" },
      { fill: "accent", d: "M60 160 C40 160 38 186 58 190 Z" },
    ],
    eyes: face(120, 150, 34, 26), clip: "M60 196 C50 158 60 116 120 104 C180 116 190 158 180 196 C170 210 70 210 60 196 Z",
  },
  chansey: {
    id: "chansey", number: 113, name: "Chansey", paint: "species", color: "#f2b6c6", accent: "#e08aa0",
    parts: [
      { fill: "body", d: "M120 76 C164 76 184 118 184 156 C184 192 156 206 120 206 C84 206 56 192 56 156 C56 118 76 76 120 76 Z" },
      { fill: "accent", d: "M96 92 C86 74 90 54 104 48 C108 68 112 84 116 92 Z" },
      { fill: "accent", d: "M144 92 C154 74 150 54 136 48 C132 68 128 84 124 92 Z" },
      { fill: "accent", d: "M120 152 C136 152 142 166 134 176 C126 182 114 182 106 176 C98 166 104 152 120 152 Z" },
    ],
    eyes: face(120, 138, 34, 26), clip: "M120 76 C164 76 184 118 184 156 C184 192 156 206 120 206 C84 206 56 192 56 156 C56 118 76 76 120 76 Z",
  },
  tangela: {
    id: "tangela", number: 114, name: "Tangela", paint: "species", color: "#5aa0c8", accent: "#3f80a8",
    parts: [
      { fill: "accent", d: "M120 84 C92 84 78 60 96 46 C112 36 132 38 144 50 C160 64 148 84 120 84 Z" },
      { fill: "accent", d: "M70 130 C48 126 42 150 58 160 Z" },
      { fill: "accent", d: "M170 130 C192 126 198 150 182 160 Z" },
      { fill: "body", d: "M120 86 C160 86 180 124 180 158 C180 192 152 206 120 206 C88 206 60 192 60 158 C60 124 80 86 120 86 Z" },
    ],
    eyes: face(120, 142, 32, 26), clip: "M120 86 C160 86 180 124 180 158 C180 192 152 206 120 206 C88 206 60 192 60 158 C60 124 80 86 120 86 Z",
  },
  kangaskhan: {
    id: "kangaskhan", number: 115, name: "Kangaskhan", paint: "species", color: "#c09a6b", accent: "#8f6f48",
    parts: [
      { fill: "accent", d: "M88 104 C72 84 74 58 90 50 C94 72 100 92 110 102 Z" },
      { fill: "accent", d: "M152 104 C168 84 166 58 150 50 C146 72 140 92 130 102 Z" },
      { fill: "body", d: "M120 90 C162 90 182 128 182 164 C182 198 152 212 120 212 C88 212 58 198 58 164 C58 128 78 90 120 90 Z" },
      { fill: "accent", d: "M120 150 C136 150 142 164 134 172 C126 178 114 178 106 172 C98 164 104 150 120 150 Z" },
    ],
    eyes: face(120, 136, 36, 26), clip: "M120 90 C162 90 182 128 182 164 C182 198 152 212 120 212 C88 212 58 198 58 164 C58 128 78 90 120 90 Z",
  },
  horsea: {
    id: "horsea", number: 116, name: "Horsea", paint: "species", color: "#7ab8d8", accent: "#c8a05a",
    parts: [
      { fill: "body", d: "M120 84 C152 84 168 116 168 144 C168 168 148 180 120 180 C92 180 72 168 72 144 C72 116 88 84 120 84 Z" },
      { fill: "accent", d: "M120 180 C118 200 126 210 138 212" },
      { fill: "accent", d: "M120 88 C110 78 108 64 118 58 C122 70 124 80 126 88 Z" },
    ],
    eyes: face(120, 132, 30, 26), clip: "M120 84 C152 84 168 116 168 144 C168 168 148 180 120 180 C92 180 72 168 72 144 C72 116 88 84 120 84 Z",
  },
  seadra: {
    id: "seadra", number: 117, name: "Seadra", paint: "species", color: "#6aa8cc", accent: "#4f8ab0",
    parts: [
      { fill: "accent", d: "M120 86 C104 66 106 42 120 30 C134 42 136 66 120 86 Z" },
      { fill: "body", d: "M120 82 C156 82 172 116 172 146 C172 174 150 188 120 188 C90 188 68 174 68 146 C68 116 84 82 120 82 Z" },
      { fill: "accent", d: "M120 188 C116 204 122 214 136 218" },
      { fill: "accent", d: "M72 120 C50 114 44 136 60 146 Z" },
    ],
    eyes: face(120, 130, 32, 26), clip: "M120 82 C156 82 172 116 172 146 C172 174 150 188 120 188 C90 188 68 174 68 146 C68 116 84 82 120 82 Z",
  },
  goldeen: {
    id: "goldeen", number: 118, name: "Goldeen", paint: "species", color: "#f0e0d8", accent: "#e8803a",
    parts: [
      { fill: "body", d: "M120 88 C152 88 168 120 168 148 C168 172 148 184 120 184 C92 184 72 172 72 148 C72 120 88 88 120 88 Z" },
      { fill: "accent", d: "M168 140 C192 130 204 142 202 162 C200 180 184 186 172 176 Z" },
      { fill: "accent", d: "M120 92 C108 78 110 60 120 50 C130 60 132 78 120 92 Z" },
    ],
    eyes: face(120, 136, 30, 26), clip: "M120 88 C152 88 168 120 168 148 C168 172 148 184 120 184 C92 184 72 172 72 148 C72 120 88 88 120 88 Z",
  },
  seaking: {
    id: "seaking", number: 119, name: "Seaking", paint: "species", color: "#ecdbd0", accent: "#e8703a",
    parts: [
      { fill: "body", d: "M120 84 C156 84 174 118 174 148 C174 174 152 188 120 188 C88 188 66 174 66 148 C66 118 84 84 120 84 Z" },
      { fill: "accent", d: "M174 140 C200 128 212 142 208 164 C204 182 186 188 174 176 Z" },
      { fill: "accent", d: "M120 88 L104 58 L120 72 L136 58 Z" },
    ],
    eyes: face(120, 132, 32, 26), clip: "M120 84 C156 84 174 118 174 148 C174 174 152 188 120 188 C88 188 66 174 66 148 C66 118 84 84 120 84 Z",
  },
  staryu: {
    id: "staryu", number: 120, name: "Staryu", paint: "species", color: "#e0b87a", accent: "#e05a5a",
    parts: [
      { fill: "body", d: "M120 44 L138 106 L200 96 L152 138 L186 194 L128 166 L120 202 L112 166 L54 194 L88 138 L40 96 L102 106 Z" },
      { fill: "accent", d: "M120 116 C134 116 140 134 130 144 C120 150 110 144 110 134 C110 122 114 116 120 116 Z" },
    ],
    eyes: face(120, 134, 22, 20), clip: "M120 44 L138 106 L200 96 L152 138 L186 194 L128 166 L120 202 L112 166 L54 194 L88 138 L40 96 L102 106 Z",
  },
  starmie: {
    id: "starmie", number: 121, name: "Starmie", paint: "species", color: "#9a7ac4", accent: "#c85a8a",
    parts: [
      { fill: "body", d: "M120 40 L140 104 L206 88 L156 136 L194 196 L130 168 L120 208 L110 168 L46 196 L84 136 L34 88 L100 104 Z" },
      { fill: "accent", d: "M120 108 C138 108 146 132 132 144 C120 152 108 146 106 132 C104 116 110 108 120 108 Z" },
    ],
    eyes: face(120, 132, 24, 22), clip: "M120 40 L140 104 L206 88 L156 136 L194 196 L130 168 L120 208 L110 168 L46 196 L84 136 L34 88 L100 104 Z",
  },
  "mr-mime": {
    id: "mr-mime", number: 122, name: "Mr. Mime", paint: "species", color: "#f0c6d4", accent: "#5a8ac8",
    parts: [
      { fill: "accent", d: "M92 92 C74 72 74 46 90 38 C94 60 100 80 108 90 Z" },
      { fill: "accent", d: "M148 92 C166 72 166 46 150 38 C146 60 140 80 132 90 Z" },
      { fill: "body", d: "M120 86 C158 86 174 124 174 158 C174 192 150 206 120 206 C90 206 66 192 66 158 C66 124 82 86 120 86 Z" },
      { fill: "accent", d: "M40 140 L66 148 L60 172 L34 164 Z" },
      { fill: "accent", d: "M200 140 L174 148 L180 172 L206 164 Z" },
    ],
    eyes: face(120, 138, 34, 26), clip: "M120 86 C158 86 174 124 174 158 C174 192 150 206 120 206 C90 206 66 192 66 158 C66 124 82 86 120 86 Z",
  },
  scyther: {
    id: "scyther", number: 123, name: "Scyther", paint: "species", color: "#8ac06a", accent: "#a8e05a",
    parts: [
      { fill: "accent", d: "M92 126 C56 100 34 116 44 154 C52 180 78 184 98 164 Z" },
      { fill: "accent", d: "M148 126 C184 100 206 116 196 154 C188 180 162 184 142 164 Z" },
      { fill: "body", d: "M104 196 C96 160 100 124 120 110 C140 124 144 160 136 196 C130 208 110 208 104 196 Z" },
      { fill: "accent", d: "M106 112 L96 86 L110 102 Z" },
      { fill: "accent", d: "M134 112 L144 86 L130 102 Z" },
    ],
    eyes: face(120, 148, 24, 26), clip: "M104 196 C96 160 100 124 120 110 C140 124 144 160 136 196 C130 208 110 208 104 196 Z",
  },
  jynx: {
    id: "jynx", number: 124, name: "Jynx", paint: "species", color: "#c88ad0", accent: "#f0d84a",
    parts: [
      { fill: "accent", d: "M120 78 C96 78 84 52 102 40 C112 32 128 32 138 40 C156 52 144 78 120 78 Z" },
      { fill: "body", d: "M120 84 C156 84 172 124 172 158 C172 192 148 206 120 206 C92 206 68 192 68 158 C68 124 84 84 120 84 Z" },
      { fill: "accent", d: "M120 148 C136 148 142 162 134 170 C126 176 114 176 106 170 C98 162 104 148 120 148 Z" },
    ],
    eyes: face(120, 136, 34, 26), clip: "M120 84 C156 84 172 124 172 158 C172 192 148 206 120 206 C92 206 68 192 68 158 C68 124 84 84 120 84 Z",
  },
  electabuzz: {
    id: "electabuzz", number: 125, name: "Electabuzz", paint: "species", color: "#f0c83e", accent: "#3d3d3d",
    parts: [
      { fill: "accent", d: "M120 88 L98 56 L120 70 L142 56 Z" },
      { fill: "body", d: "M120 86 C158 86 174 124 174 158 C174 192 150 206 120 206 C90 206 66 192 66 158 C66 124 82 86 120 86 Z" },
      { fill: "accent", d: "M120 150 C138 150 144 164 134 172 C124 178 112 176 106 168 C100 156 110 150 120 150 Z" },
    ],
    eyes: face(120, 138, 34, 26), clip: "M120 86 C158 86 174 124 174 158 C174 192 150 206 120 206 C90 206 66 192 66 158 C66 124 82 86 120 86 Z",
  },
  magmar: {
    id: "magmar", number: 126, name: "Magmar", paint: "species", color: "#e8683a", accent: "#f0c04a",
    parts: [
      { fill: "accent", d: "M120 82 C104 60 108 34 122 22 C126 44 128 66 126 82 Z" },
      { fill: "body", d: "M120 86 C158 86 176 124 176 158 C176 192 152 206 120 206 C88 206 64 192 64 158 C64 124 82 86 120 86 Z" },
      { fill: "accent", d: "M120 148 C140 148 148 164 136 174 C124 182 108 178 102 166 C96 152 108 148 120 148 Z" },
    ],
    eyes: face(120, 136, 34, 26), clip: "M120 86 C158 86 176 124 176 158 C176 192 152 206 120 206 C88 206 64 192 64 158 C64 124 82 86 120 86 Z",
  },
  pinsir: {
    id: "pinsir", number: 127, name: "Pinsir", paint: "species", color: "#b08a5a", accent: "#8a6a40",
    parts: [
      { fill: "accent", d: "M84 110 C58 92 40 104 44 134 C48 154 70 156 86 138 Z" },
      { fill: "accent", d: "M156 110 C182 92 200 104 196 134 C192 154 170 156 154 138 Z" },
      { fill: "body", d: "M120 90 C158 90 176 126 176 160 C176 194 150 208 120 208 C90 208 64 194 64 160 C64 126 82 90 120 90 Z" },
      { fill: "accent", d: "M104 94 L96 70 L112 86 Z" },
      { fill: "accent", d: "M136 94 L144 70 L128 86 Z" },
    ],
    eyes: face(120, 138, 34, 26), clip: "M120 90 C158 90 176 126 176 160 C176 194 150 208 120 208 C90 208 64 194 64 160 C64 126 82 90 120 90 Z",
  },
  tauros: {
    id: "tauros", number: 128, name: "Tauros", paint: "species", color: "#b89a6a", accent: "#e8e0d0",
    parts: [
      { fill: "accent", d: "M86 104 C64 96 52 72 64 56 C70 76 78 94 90 102 Z" },
      { fill: "accent", d: "M154 104 C176 96 188 72 176 56 C170 76 162 94 150 102 Z" },
      { fill: "body", d: "M120 90 C160 90 180 128 180 164 C180 198 150 212 120 212 C90 212 60 198 60 164 C60 128 80 90 120 90 Z" },
      { fill: "accent", d: "M120 148 C138 148 144 164 134 172 C124 180 110 178 104 168 C98 154 108 148 120 148 Z" },
    ],
    eyes: face(120, 136, 36, 26), clip: "M120 90 C160 90 180 128 180 164 C180 198 150 212 120 212 C90 212 60 198 60 164 C60 128 80 90 120 90 Z",
  },
  magikarp: {
    id: "magikarp", number: 129, name: "Magikarp", paint: "species", color: "#e05a3a", accent: "#f0d0a0",
    parts: [
      { fill: "body", d: "M120 100 C150 100 166 128 166 152 C166 174 148 186 120 186 C92 186 74 174 74 152 C74 128 90 100 120 100 Z" },
      { fill: "accent", d: "M166 144 C192 134 206 148 202 168 C198 184 182 188 170 176 Z" },
      { fill: "accent", d: "M120 104 L108 84 L120 92 L132 84 Z" },
      { fill: "accent", d: "M92 180 C84 194 90 204 102 204" },
    ],
    eyes: face(120, 142, 30, 24), clip: "M120 100 C150 100 166 128 166 152 C166 174 148 186 120 186 C92 186 74 174 74 152 C74 128 90 100 120 100 Z",
  },
  gyarados: {
    id: "gyarados", number: 130, name: "Gyarados", paint: "species", color: "#5a8ac4", accent: "#f0d84a",
    parts: [
      { fill: "accent", d: "M120 88 C100 62 104 34 122 24 C128 48 130 70 128 88 Z" },
      { fill: "body", d: "M120 82 C160 82 180 122 180 158 C180 194 152 210 120 210 C88 210 60 194 60 158 C60 122 80 82 120 82 Z" },
      { fill: "accent", d: "M60 130 C36 122 28 148 46 160 Z" },
      { fill: "accent", d: "M180 130 C204 122 212 148 194 160 Z" },
      { fill: "accent", d: "M120 148 C140 148 148 166 134 176 C122 184 106 180 100 168 C94 152 108 148 120 148 Z" },
    ],
    eyes: face(120, 132, 36, 26), clip: "M120 82 C160 82 180 122 180 158 C180 194 152 210 120 210 C88 210 60 194 60 158 C60 122 80 82 120 82 Z",
  },
  lapras: {
    id: "lapras", number: 131, name: "Lapras", paint: "species", color: "#6a9ad4", accent: "#c8d8e8",
    parts: [
      { fill: "body", d: "M120 84 C162 84 184 124 184 160 C184 196 154 212 120 212 C86 212 56 196 56 160 C56 124 78 84 120 84 Z" },
      { fill: "accent", d: "M120 90 L102 62 L120 74 L138 62 Z" },
      { fill: "accent", d: "M56 140 C34 140 30 168 50 176 Z" },
      { fill: "accent", d: "M184 140 C206 140 210 168 190 176 Z" },
    ],
    eyes: face(120, 136, 38, 26), clip: "M120 84 C162 84 184 124 184 160 C184 196 154 212 120 212 C86 212 56 196 56 160 C56 124 78 84 120 84 Z",
  },
  ditto: {
    id: "ditto", number: 132, name: "Ditto", paint: "species", color: "#b48ad4", accent: "#9670b8",
    parts: [
      { fill: "body", d: "M120 94 C158 94 176 130 176 162 C176 194 152 208 120 208 C88 208 64 194 64 162 C64 130 82 94 120 94 Z" },
      { fill: "accent", d: "M108 96 C104 84 110 76 120 76 C130 76 136 84 132 96 Z" },
    ],
    eyes: face(120, 142, 34, 26), clip: "M120 94 C158 94 176 130 176 162 C176 194 152 208 120 208 C88 208 64 194 64 162 C64 130 82 94 120 94 Z",
  },
  eevee: {
    id: "eevee", number: 133, name: "Eevee", paint: "species", color: "#c89a5a", accent: "#f0e0c0",
    parts: [
      { fill: "accent", d: "M90 106 C72 84 72 54 88 44 C94 68 100 90 110 102 Z" },
      { fill: "accent", d: "M150 106 C168 84 168 54 152 44 C146 68 140 90 130 102 Z" },
      { fill: "body", d: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z" },
      { fill: "accent", d: "M120 158 C136 158 142 172 132 180 C122 186 110 182 106 172 C102 160 112 158 120 158 Z" },
    ],
    eyes: face(120, 140, 30, 30), clip: "M84 190 C74 152 82 114 120 100 C158 114 166 152 156 190 C146 204 94 204 84 190 Z",
  },
  vaporeon: {
    id: "vaporeon", number: 134, name: "Vaporeon", paint: "species", color: "#5aaad4", accent: "#d8e8f0",
    parts: [
      { fill: "accent", d: "M120 96 C100 78 100 50 118 40 C124 62 128 82 128 96 Z" },
      { fill: "accent", d: "M92 100 C74 84 68 58 82 46 C90 68 96 86 106 98 Z" },
      { fill: "body", d: "M120 94 C158 94 176 130 176 162 C176 194 150 208 120 208 C90 208 64 194 64 162 C64 130 82 94 120 94 Z" },
    ],
    eyes: face(120, 138, 34, 28), clip: "M120 94 C158 94 176 130 176 162 C176 194 150 208 120 208 C90 208 64 194 64 162 C64 130 82 94 120 94 Z",
  },
  jolteon: {
    id: "jolteon", number: 135, name: "Jolteon", paint: "species", color: "#f0d44f", accent: "#f8f0c0",
    parts: [
      { fill: "accent", d: "M120 94 L102 56 L120 72 L120 44 L138 72 L120 72 Z" },
      { fill: "accent", d: "M86 104 C68 88 62 62 76 50 C84 72 90 90 100 100 Z" },
      { fill: "body", d: "M120 92 C158 92 176 128 176 160 C176 192 150 206 120 206 C90 206 64 192 64 160 C64 128 82 92 120 92 Z" },
    ],
    eyes: face(120, 136, 34, 28), clip: "M120 92 C158 92 176 128 176 160 C176 192 150 206 120 206 C90 206 64 192 64 160 C64 128 82 92 120 92 Z",
  },
  flareon: {
    id: "flareon", number: 136, name: "Flareon", paint: "species", color: "#e8723a", accent: "#f0c860",
    parts: [
      { fill: "accent", d: "M120 92 C104 68 110 42 124 32 C128 54 128 78 126 92 Z" },
      { fill: "accent", d: "M86 106 C64 94 56 66 72 52 C80 76 88 94 100 102 Z" },
      { fill: "body", d: "M120 90 C158 90 176 128 176 160 C176 192 150 206 120 206 C90 206 64 192 64 160 C64 128 82 90 120 90 Z" },
      { fill: "accent", d: "M120 152 C138 152 144 168 132 176 C120 182 106 178 102 166 C98 152 110 152 120 152 Z" },
    ],
    eyes: face(120, 136, 34, 26), clip: "M120 90 C158 90 176 128 176 160 C176 192 150 206 120 206 C90 206 64 192 64 160 C64 128 82 90 120 90 Z",
  },
  porygon: {
    id: "porygon", number: 137, name: "Porygon", paint: "species", color: "#e07ab0", accent: "#5a9ad8",
    parts: [
      { fill: "accent", d: "M120 92 L146 60 L166 92 L146 124 Z" },
      { fill: "body", d: "M108 96 L132 96 L156 140 L132 196 L108 196 L84 140 Z" },
      { fill: "accent", d: "M84 140 L56 168 L72 196 L96 172 Z" },
    ],
    eyes: face(120, 144, 22, 22), clip: "M108 96 L132 96 L156 140 L132 196 L108 196 L84 140 Z",
  },
  omanyte: {
    id: "omanyte", number: 138, name: "Omanyte", paint: "species", color: "#6a9ac0", accent: "#e8e0d0",
    parts: [
      { fill: "body", d: "M120 100 C156 100 174 132 174 162 C174 194 150 206 120 206 C90 206 66 194 66 162 C66 132 84 100 120 100 Z" },
      { fill: "accent", d: "M120 78 C146 78 162 104 160 132 C150 116 136 108 120 108 C104 108 90 116 80 132 C78 104 94 78 120 78 Z" },
      { fill: "accent", d: "M102 118 C94 134 94 152 102 168 M138 118 C146 134 146 152 138 168" },
    ],
    eyes: face(120, 148, 28, 26), clip: "M120 100 C156 100 174 132 174 162 C174 194 150 206 120 206 C90 206 66 194 66 162 C66 132 84 100 120 100 Z",
  },
  omastar: {
    id: "omastar", number: 139, name: "Omastar", paint: "species", color: "#5a8ab0", accent: "#dcd4c4",
    parts: [
      { fill: "body", d: "M120 96 C160 96 180 130 180 162 C180 196 152 210 120 210 C88 210 60 196 60 162 C60 130 80 96 120 96 Z" },
      { fill: "accent", d: "M120 66 C152 66 172 98 168 132 C156 112 140 102 120 102 C100 102 84 112 72 132 C68 98 88 66 120 66 Z" },
      { fill: "accent", d: "M96 116 C86 136 86 158 96 178 M144 116 C154 136 154 158 144 178" },
    ],
    eyes: face(120, 146, 30, 26), clip: "M120 96 C160 96 180 130 180 162 C180 196 152 210 120 210 C88 210 60 196 60 162 C60 130 80 96 120 96 Z",
  },
  kabuto: {
    id: "kabuto", number: 140, name: "Kabuto", paint: "species", color: "#b8845a", accent: "#6f4a2e",
    parts: [
      { fill: "body", d: "M120 104 C156 104 172 136 172 166 C172 196 150 208 120 208 C90 208 68 196 68 166 C68 136 84 104 120 104 Z" },
      { fill: "accent", d: "M120 100 C138 100 150 118 148 138 C140 124 130 118 120 118 C110 118 100 124 92 138 C90 118 102 100 120 100 Z" },
      { fill: "accent", d: "M104 110 C96 96 98 80 110 74 M136 110 C144 96 142 80 130 74" },
    ],
    eyes: face(120, 152, 28, 24), clip: "M120 104 C156 104 172 136 172 166 C172 196 150 208 120 208 C90 208 68 196 68 166 C68 136 84 104 120 104 Z",
  },
  kabutops: {
    id: "kabutops", number: 141, name: "Kabutops", paint: "species", color: "#a8744c", accent: "#5f4028",
    parts: [
      { fill: "accent", d: "M70 148 L36 122 L72 126 L48 96 L88 134 Z" },
      { fill: "accent", d: "M170 148 L204 122 L168 126 L192 96 L152 134 Z" },
      { fill: "body", d: "M120 90 C158 90 176 128 176 160 C176 192 150 206 120 206 C90 206 64 192 64 160 C64 128 82 90 120 90 Z" },
      { fill: "accent", d: "M120 94 C104 78 104 56 118 46 C122 66 124 82 124 94 Z" },
    ],
    eyes: face(120, 136, 34, 26), clip: "M120 90 C158 90 176 128 176 160 C176 192 150 206 120 206 C90 206 64 192 64 160 C64 128 82 90 120 90 Z",
  },
  aerodactyl: {
    id: "aerodactyl", number: 142, name: "Aerodactyl", paint: "species", color: "#a09ab0", accent: "#706a80",
    parts: [
      { fill: "accent", d: "M96 130 L40 94 L56 148 L28 186 L92 166 Z" },
      { fill: "accent", d: "M144 130 L200 94 L184 148 L212 186 L148 166 Z" },
      { fill: "body", d: "M104 200 C96 164 100 128 120 114 C140 128 144 164 136 200 C130 210 110 210 104 200 Z" },
      { fill: "accent", d: "M106 116 L96 92 L114 108 Z" },
      { fill: "accent", d: "M134 116 L144 92 L126 108 Z" },
    ],
    eyes: face(120, 152, 22, 24), clip: "M104 200 C96 164 100 128 120 114 C140 128 144 164 136 200 C130 210 110 210 104 200 Z",
  },
  snorlax: {
    id: "snorlax", number: 143, name: "Snorlax", paint: "species", color: "#5a8a9a", accent: "#e8e0d0",
    parts: [
      { fill: "body", d: "M120 72 C168 72 190 116 190 158 C190 198 158 214 120 214 C82 214 50 198 50 158 C50 116 72 72 120 72 Z" },
      { fill: "accent", d: "M120 72 C104 74 98 92 106 104 C114 112 128 112 134 102 C140 88 134 74 120 72 Z" },
      { fill: "accent", d: "M76 150 C56 150 52 178 72 184 Z" },
      { fill: "accent", d: "M164 150 C184 150 188 178 168 184 Z" },
    ],
    eyes: face(120, 136, 38, 22), clip: "M120 72 C168 72 190 116 190 158 C190 198 158 214 120 214 C82 214 50 198 50 158 C50 116 72 72 120 72 Z",
  },
  articuno: {
    id: "articuno", number: 144, name: "Articuno", paint: "species", color: "#5ab0d8", accent: "#c8e8f8",
    parts: [
      { fill: "accent", d: "M94 128 C50 104 26 130 42 172 C54 198 84 194 102 168 Z" },
      { fill: "accent", d: "M146 128 C190 104 214 130 198 172 C186 198 156 194 138 168 Z" },
      { fill: "body", d: "M104 200 C96 164 100 128 120 112 C140 128 144 164 136 200 C130 210 110 210 104 200 Z" },
      { fill: "accent", d: "M120 114 L106 90 L120 100 L134 90 Z" },
    ],
    eyes: face(120, 150, 22, 24), clip: "M104 200 C96 164 100 128 120 112 C140 128 144 164 136 200 C130 210 110 210 104 200 Z",
  },
  zapdos: {
    id: "zapdos", number: 145, name: "Zapdos", paint: "species", color: "#e0c43e", accent: "#f8f0b0",
    parts: [
      { fill: "accent", d: "M92 126 L44 96 L64 144 L34 184 L98 164 Z" },
      { fill: "accent", d: "M148 126 L196 96 L176 144 L206 184 L142 164 Z" },
      { fill: "body", d: "M104 200 C96 164 100 128 120 112 C140 128 144 164 136 200 C130 210 110 210 104 200 Z" },
      { fill: "accent", d: "M120 112 L108 84 L120 96 L132 84 Z" },
    ],
    eyes: face(120, 150, 22, 24), clip: "M104 200 C96 164 100 128 120 112 C140 128 144 164 136 200 C130 210 110 210 104 200 Z",
  },
  moltres: {
    id: "moltres", number: 146, name: "Moltres", paint: "species", color: "#e86a3a", accent: "#f8c860",
    parts: [
      { fill: "accent", d: "M92 124 C48 96 22 122 38 168 C50 198 82 196 100 164 Z" },
      { fill: "accent", d: "M148 124 C192 96 218 122 202 168 C190 198 158 196 140 164 Z" },
      { fill: "body", d: "M104 200 C96 164 100 128 120 112 C140 128 144 164 136 200 C130 210 110 210 104 200 Z" },
      { fill: "accent", d: "M120 112 C106 88 112 60 128 50 C130 74 128 96 124 112 Z" },
    ],
    eyes: face(120, 150, 22, 24), clip: "M104 200 C96 164 100 128 120 112 C140 128 144 164 136 200 C130 210 110 210 104 200 Z",
  },
  dratini: {
    id: "dratini", number: 147, name: "Dratini", paint: "species", color: "#5aa8c8", accent: "#c8e0ec",
    parts: [
      { fill: "body", d: "M120 86 C154 86 172 118 172 148 C172 174 150 186 120 186 C90 186 68 174 68 148 C68 118 86 86 120 86 Z" },
      { fill: "accent", d: "M120 186 C126 206 140 216 158 214" },
      { fill: "accent", d: "M96 100 C88 84 92 68 104 62 C108 78 108 92 104 100 Z" },
      { fill: "accent", d: "M144 100 C152 84 148 68 136 62 C132 78 132 92 136 100 Z" },
    ],
    eyes: face(120, 136, 30, 26), clip: "M120 86 C154 86 172 118 172 148 C172 174 150 186 120 186 C90 186 68 174 68 148 C68 118 86 86 120 86 Z",
  },
  dragonair: {
    id: "dragonair", number: 148, name: "Dragonair", paint: "species", color: "#5a96c8", accent: "#c8e8f0",
    parts: [
      { fill: "body", d: "M120 80 C158 80 178 116 178 150 C178 178 152 192 120 192 C88 192 62 178 62 150 C62 116 82 80 120 80 Z" },
      { fill: "accent", d: "M120 192 C124 212 138 222 158 220" },
      { fill: "accent", d: "M92 96 C82 80 86 62 98 56 C102 74 102 88 98 96 Z" },
      { fill: "accent", d: "M148 96 C158 80 154 62 142 56 C138 74 138 88 142 96 Z" },
      { fill: "accent", d: "M120 88 C112 76 114 60 124 54 C128 66 128 80 124 88 Z" },
    ],
    eyes: face(120, 132, 32, 26), clip: "M120 80 C158 80 178 116 178 150 C178 178 152 192 120 192 C88 192 62 178 62 150 C62 116 82 80 120 80 Z",
  },
  dragonite: {
    id: "dragonite", number: 149, name: "Dragonite", paint: "species", color: "#e0b04a", accent: "#b08838",
    parts: [
      { fill: "accent", d: "M92 128 L44 102 L62 156 L32 192 L96 168 Z" },
      { fill: "accent", d: "M148 128 L196 102 L178 156 L208 192 L144 168 Z" },
      { fill: "body", d: "M120 88 C160 88 178 126 178 160 C178 194 152 208 120 208 C88 208 62 194 62 160 C62 126 80 88 120 88 Z" },
      { fill: "accent", d: "M96 92 C86 76 90 60 102 54 C106 70 106 84 102 92 Z" },
      { fill: "accent", d: "M144 92 C154 76 150 60 138 54 C134 70 134 84 138 92 Z" },
    ],
    eyes: face(120, 136, 34, 26), clip: "M120 88 C160 88 178 126 178 160 C178 194 152 208 120 208 C88 208 62 194 62 160 C62 126 80 88 120 88 Z",
  },
  mewtwo: {
    id: "mewtwo", number: 150, name: "Mewtwo", paint: "species", color: "#c8c0d4", accent: "#8f86a0",
    parts: [
      { fill: "accent", d: "M92 96 C76 74 78 48 94 40 C98 62 102 82 110 92 Z" },
      { fill: "accent", d: "M148 96 C164 74 162 48 146 40 C142 62 138 82 130 92 Z" },
      { fill: "body", d: "M120 84 C160 84 178 124 178 160 C178 194 152 208 120 208 C88 208 62 194 62 160 C62 124 80 84 120 84 Z" },
      { fill: "accent", d: "M120 148 C138 148 146 164 134 174 C122 182 106 178 100 166 C94 152 108 148 120 148 Z" },
    ],
    eyes: face(120, 134, 36, 26), clip: "M120 84 C160 84 178 124 178 160 C178 194 152 208 120 208 C88 208 62 194 62 160 C62 124 80 84 120 84 Z",
  },
  mew: {
    id: "mew", number: 151, name: "Mew", paint: "species", color: "#f0b8d0", accent: "#e08ab0",
    parts: [
      { fill: "accent", d: "M92 100 C76 82 78 58 92 50 C96 70 100 88 108 98 Z" },
      { fill: "accent", d: "M148 100 C164 82 162 58 148 50 C144 70 140 88 132 98 Z" },
      { fill: "body", d: "M120 88 C158 88 176 124 176 158 C176 192 150 206 120 206 C90 206 64 192 64 158 C64 124 82 88 120 88 Z" },
      { fill: "accent", d: "M120 196 C126 212 140 218 154 214" },
    ],
    eyes: face(120, 138, 32, 26), clip: "M120 88 C158 88 176 124 176 158 C176 192 150 206 120 206 C90 206 64 192 64 158 C64 124 82 88 120 88 Z",
  },
};
