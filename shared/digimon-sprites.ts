/**
 * The Digimon a bot can wear, from the Digimon API's own catalogue.
 *
 * GENERATED FILE — do not hand-edit. Run `pnpm gen:digimon` to rebuild it from
 * `scripts/fetch-digimon-sprites.mjs`, which downloads each picture and trims it to a transparent
 * 96px square.
 *
 * These are the API's portraits, not game sprites: they stand beside the Pokémon sprites as
 * illustrations of the creature rather than as the same kind of pixel art.
 */
export interface DigimonSprite {
  name: string;
  /** The level the catalogue lists, which groups the picker. */
  level: string;
  /** The file under /digimon. */
  slug: string;
}

export const DIGIMON_SPRITES: readonly DigimonSprite[] = [
  { name: "Koromon", level: "In Training", slug: "koromon" },
  { name: "Tsunomon", level: "In Training", slug: "tsunomon" },
  { name: "Yokomon", level: "In Training", slug: "yokomon" },
  { name: "Motimon", level: "In Training", slug: "motimon" },
  { name: "Tanemon", level: "In Training", slug: "tanemon" },
  { name: "Bukamon", level: "In Training", slug: "bukamon" },
  { name: "Tokomon", level: "In Training", slug: "tokomon" },
  { name: "Agumon", level: "Rookie", slug: "agumon" },
  { name: "Gabumon", level: "Rookie", slug: "gabumon" },
  { name: "Biyomon", level: "Rookie", slug: "biyomon" },
  { name: "Tentomon", level: "Rookie", slug: "tentomon" },
  { name: "Palmon", level: "Rookie", slug: "palmon" },
  { name: "Gomamon", level: "Rookie", slug: "gomamon" },
  { name: "Patamon", level: "Rookie", slug: "patamon" },
  { name: "Elecmon", level: "Rookie", slug: "elecmon" },
  { name: "Gazimon", level: "Rookie", slug: "gazimon" },
  { name: "Pagumon", level: "In Training", slug: "pagumon" },
  { name: "DemiDevimon", level: "Rookie", slug: "demidevimon" },
  { name: "Otamamon", level: "Rookie", slug: "otamamon" },
  { name: "Gotsumon", level: "Rookie", slug: "gotsumon" },
  { name: "Gizamon", level: "Rookie", slug: "gizamon" },
  { name: "Nyaromon", level: "In Training", slug: "nyaromon" },
  { name: "Salamon", level: "Rookie", slug: "salamon" },
  { name: "Chuumon", level: "Rookie", slug: "chuumon" },
  { name: "Mushroomon", level: "Rookie", slug: "mushroomon" },
  { name: "Floramon", level: "Rookie", slug: "floramon" },
  { name: "Hagurumon", level: "Rookie", slug: "hagurumon" },
  { name: "Kunemon", level: "Rookie", slug: "kunemon" },
  { name: "Candlemon", level: "Rookie", slug: "candlemon" },
  { name: "Kokuwamon", level: "Rookie", slug: "kokuwamon" },
  { name: "Syakomon", level: "Rookie", slug: "syakomon" },
  { name: "Betamon", level: "Rookie", slug: "betamon" },
  { name: "Penguinmon", level: "Rookie", slug: "penguinmon" },
  { name: "Psychemon", level: "Rookie", slug: "psychemon" },
  { name: "Tsukaimon", level: "Rookie", slug: "tsukaimon" },
  { name: "SnowAgumon", level: "Rookie", slug: "snowagumon" },
  { name: "Muchomon", level: "Rookie", slug: "muchomon" },
  { name: "Hawkmon", level: "Rookie", slug: "hawkmon" },
  { name: "Armadillomon", level: "Rookie", slug: "armadillomon" },
  { name: "Wormmon", level: "Rookie", slug: "wormmon" },
] as const;
