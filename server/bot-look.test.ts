import { describe, expect, it } from "vitest";

import { MASCOT_BODY_IDS } from "../shared/mascot-bodies.ts";
import { freshLook, STARTER_COLORS, STARTER_SHAPES } from "./bot-look.ts";

describe("a new bot's first look", () => {
  it("is one of eight shapes and never a metal colour", () => {
    expect(STARTER_SHAPES).toHaveLength(8);
    expect(STARTER_SHAPES.every((shape) => MASCOT_BODY_IDS.includes(shape))).toBe(true);
    expect(STARTER_COLORS).not.toContain("silver");
    expect(STARTER_COLORS).not.toContain("chrome");
  });

  it("is random, and prefers a colour and a shape no bot here wears yet", () => {
    expect(freshLook([], () => 0)).not.toEqual(freshLook([], () => 0.999));
    const worn = [{ color: "red" as const, mascotBody: "blob" }, { color: "blue" as const }];
    for (const roll of [0, 0.3, 0.6, 0.999]) {
      const look = freshLook(worn, () => roll);
      expect(["red", "blue"]).not.toContain(look.color);
      expect(["blob", "cursor"]).not.toContain(look.mascotBody);
    }
    const everyShape = STARTER_SHAPES.map((mascotBody) => ({ color: "green" as const, mascotBody }));
    expect(STARTER_SHAPES).toContain(freshLook(everyShape, () => 0.5).mascotBody);
  });
});
