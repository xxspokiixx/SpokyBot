/** Every body a bot can wear: the gradient catalog, the Halloween bodies and the first 151 Pokémon. */

import { z } from "zod";

import { DEFAULT_MASCOT_BODY, MASCOT_BODY_IDS } from "./mascot-bodies.ts";
import { HALLOWEEN_BODY_IDS, type HalloweenBodyId } from "./halloween-bodies.ts";
import { POKEMON_BODY_IDS, type PokemonBodyId } from "./pokemon-bodies.ts";
import type { MausColor } from "./wire.ts";

export const BOT_BODY_IDS = [...MASCOT_BODY_IDS, ...HALLOWEEN_BODY_IDS, ...POKEMON_BODY_IDS] as const;

export type BotBodyId = (typeof BOT_BODY_IDS)[number];

export const botBodySchema = z.enum(BOT_BODY_IDS);

/** Runtime-safe read of an untrusted persisted or streamed body id. */
export function botBodyId(value: unknown): BotBodyId {
  return botBodySchema.safeParse(value).data ?? DEFAULT_MASCOT_BODY;
}

export function isHalloweenBody(value: unknown): value is HalloweenBodyId {
  return (HALLOWEEN_BODY_IDS as readonly unknown[]).includes(value);
}

export function isPokemonBody(value: unknown): value is PokemonBodyId {
  return (POKEMON_BODY_IDS as readonly unknown[]).includes(value);
}

/** The costume each bot colour wears when "Dress my bots up" is on with the Halloween skin. */
export const COSTUME_FOR_COLOR: Record<Exclude<MausColor, "silver" | "chrome">, HalloweenBodyId> = {
  orange: "pumpkin",
  purple: "ghost",
  teal: "witch",
  red: "bat",
  blue: "cat",
  cyan: "skull",
  green: "monster",
  yellow: "mummy",
  coral: "vampire",
  pink: "spider",
};
