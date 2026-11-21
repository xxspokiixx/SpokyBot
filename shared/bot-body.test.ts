import { describe, expect, it } from "vitest";

import { BOT_BODY_IDS, COSTUME_FOR_COLOR, botBodyId, botBodySchema, isHalloweenBody, isPokemonBody } from "./bot-body.ts";
import { HALLOWEEN_BODY_IDS } from "./halloween-bodies.ts";
import { MASCOT_BODY_IDS } from "./mascot-bodies.ts";
import { POKEMON_BODIES, POKEMON_BODY_IDS } from "./pokemon-bodies.ts";
import { MAUS_COLOR_NAMES } from "./wire.ts";

describe("bot bodies", () => {
  it("accepts every gradient body, every Halloween body and every Pokémon body", () => {
    expect(BOT_BODY_IDS).toEqual([...MASCOT_BODY_IDS, ...HALLOWEEN_BODY_IDS, ...POKEMON_BODY_IDS]);
    for (const id of BOT_BODY_IDS) expect(botBodySchema.safeParse(id).success).toBe(true);
  });

  it("falls back to the cursor for anything it does not know", () => {
    expect(botBodyId("pumpkin")).toBe("pumpkin");
    expect(botBodyId("star")).toBe("star");
    expect(botBodyId("hexagram")).toBe("cursor");
    expect(botBodyId(undefined)).toBe("cursor");
  });

  it("tells the Halloween bodies apart", () => {
    expect(isHalloweenBody("ghost")).toBe(true);
    expect(isHalloweenBody("cursor")).toBe(false);
    expect(isHalloweenBody(null)).toBe(false);
  });

  it("tells the Pokémon bodies apart", () => {
    expect(isPokemonBody("pikachu")).toBe(true);
    expect(isPokemonBody("ghost")).toBe(false);
    expect(isPokemonBody(null)).toBe(false);
  });

  it("gives every bot colour but silver and chrome its own costume", () => {
    const dressed = MAUS_COLOR_NAMES.filter((color) => color !== "silver" && color !== "chrome");
    expect(Object.keys(COSTUME_FOR_COLOR).sort()).toEqual([...dressed].sort());
    expect(new Set(Object.values(COSTUME_FOR_COLOR)).size).toBe(dressed.length);
    for (const body of Object.values(COSTUME_FOR_COLOR)) expect(isHalloweenBody(body)).toBe(true);
  });
});

describe("the first generation", () => {
  it("carries all 151, numbered once each in order", () => {
    expect(POKEMON_BODY_IDS).toHaveLength(151);
    const numbers = POKEMON_BODY_IDS.map((id) => POKEMON_BODIES[id].number);
    expect(numbers).toEqual(Array.from({ length: 151 }, (_, i) => i + 1));
  });

  it("gives every one an id that matches its key and a name", () => {
    for (const id of POKEMON_BODY_IDS) {
      const body = POKEMON_BODIES[id];
      expect(body.id, id).toBe(id);
      expect(body.name.trim(), id).not.toBe("");
      expect(body.parts.length, id).toBeGreaterThan(0);
      expect(body.clip, id).toContain("M");
      for (const part of body.parts) expect(part.d, `${id} part`).toContain("M");
    }
  });

  it("keeps every face inside its own silhouette, so the eyes are never cut off", () => {
    for (const id of POKEMON_BODY_IDS) {
      const { eyes } = POKEMON_BODIES[id];
      // The same box the Halloween catalog keeps: a face between 40 and 200, and an opening wide enough.
      expect(eyes.cx, id).toBeGreaterThan(60);
      expect(eyes.cx, id).toBeLessThan(180);
      expect(eyes.cy, id).toBeGreaterThan(60);
      expect(eyes.cy, id).toBeLessThan(210);
      expect(eyes.dx, id).toBeGreaterThan(14);
      expect(eyes.w, id).toBeGreaterThan(10);
      expect(eyes.h, id).toBeGreaterThan(10);
      expect(eyes.round, id).toBeGreaterThan(10);
      expect(eyes.dx * 2 + eyes.w, `${id} fits across the 240 square`).toBeLessThan(220);
    }
  });

  it("paints a species in its own colour and a costume body in the bot's", () => {
    for (const id of POKEMON_BODY_IDS) {
      const body = POKEMON_BODIES[id];
      expect(["bot", "species"], id).toContain(body.paint);
      if (body.paint === "species") expect(body.color, id).toMatch(/^#[0-9a-f]{6}$/u);
    }
  });
});
