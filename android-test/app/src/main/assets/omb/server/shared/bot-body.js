/** Every body a bot can wear: the gradient catalog plus the Halloween bodies. */
import { z } from "zod";
import { DEFAULT_MASCOT_BODY, MASCOT_BODY_IDS } from "./mascot-bodies.js";
import { HALLOWEEN_BODY_IDS } from "./halloween-bodies.js";
export const BOT_BODY_IDS = [...MASCOT_BODY_IDS, ...HALLOWEEN_BODY_IDS];
export const botBodySchema = z.enum(BOT_BODY_IDS);
/** Runtime-safe read of an untrusted persisted or streamed body id. */
export function botBodyId(value) {
    return botBodySchema.safeParse(value).data ?? DEFAULT_MASCOT_BODY;
}
export function isHalloweenBody(value) {
    return HALLOWEEN_BODY_IDS.includes(value);
}
/** The costume each bot colour wears when "Dress my bots up" is on with the Halloween skin. */
export const COSTUME_FOR_COLOR = {
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
