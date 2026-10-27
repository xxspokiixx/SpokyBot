import { MASCOT_BODY_IDS, type MascotBodyId } from "../shared/mascot-bodies.ts";
import { MAUS_COLOR_NAMES, type MausColor } from "../shared/wire.ts";

export const STARTER_SHAPES: readonly MascotBodyId[] = ["cursor", "blob", "circle", "squircle", "drop", "hexagon", "diamond", "star"];
export const STARTER_COLORS: readonly MausColor[] = MAUS_COLOR_NAMES.filter((color) => color !== "silver" && color !== "chrome");
const ROTATION: readonly MausColor[] = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"];

/** The colour of the bot made `index`-th when nothing else picks one. */
export const rotationColor = (index: number): MausColor => ROTATION[index % ROTATION.length]!;

/** A new bot's first look, at random, preferring a colour and a shape no bot here wears yet. */
export function freshLook(
  bots: ReadonlyArray<{ color: MausColor; mascotBody?: string | null }>,
  random: () => number = Math.random,
): { color: MausColor; mascotBody: MascotBodyId } {
  const pick = <T,>(all: readonly T[], worn: ReadonlyArray<unknown>): T => {
    const unworn = all.filter((item) => !worn.includes(item));
    const pool = unworn.length ? unworn : all;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
  };
  return {
    color: pick(STARTER_COLORS, bots.map((bot) => bot.color)),
    mascotBody: pick(STARTER_SHAPES, bots.map((bot) => bot.mascotBody ?? MASCOT_BODY_IDS[0])),
  };
}
