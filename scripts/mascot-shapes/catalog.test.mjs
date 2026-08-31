import { describe, expect, it } from "vitest";

import {
  DEFAULT_MASCOT_SHAPE,
  MASCOT_SHAPES,
  MASCOT_SHAPE_IDS,
  botMascotShape,
  mascotShapeSchema,
} from "../../shared/mascot-shapes.ts";

describe("the generated catalog", () => {
  it("carries all ten shapes", () => {
    expect(MASCOT_SHAPE_IDS).toHaveLength(10);
    for (const id of MASCOT_SHAPE_IDS) expect(MASCOT_SHAPES[id].id).toBe(id);
  });

  it("defaults to the cursor", () => {
    expect(DEFAULT_MASCOT_SHAPE).toBe("cursor");
  });

  it("gives every shape the markup the renderer expects", () => {
    for (const id of MASCOT_SHAPE_IDS) {
      const shape = MASCOT_SHAPES[id];
      expect(shape.body, id).toContain('fill="{{GRADIENT}}"');
      expect(shape.clip, id).not.toContain("fill=");
      expect(shape.fit, id).toMatch(/^translate\(/);
      expect(shape.name.length, id).toBeGreaterThan(0);
    }
  });

  it("places every face inside its body", () => {
    for (const id of MASCOT_SHAPE_IDS) {
      const { anchor } = MASCOT_SHAPES[id];
      expect(anchor.scale, id).toBeGreaterThan(0);
      expect(anchor.scale, id).toBeLessThanOrEqual(1);
      expect(anchor.x, id).toBeGreaterThan(0);
      expect(anchor.y, id).toBeGreaterThan(0);
    }
  });

  it("clamps every face to one shared size", () => {
    const scales = new Set(MASCOT_SHAPE_IDS.map(id => MASCOT_SHAPES[id].anchor.scale));
    expect([...scales]).toHaveLength(1);
  });
});

describe("botMascotShape", () => {
  it("accepts a known id", () => {
    expect(botMascotShape("blob")).toBe("blob");
  });

  it("falls back to the cursor for anything else", () => {
    expect(botMascotShape("hexagram")).toBe("cursor");
    expect(botMascotShape(undefined)).toBe("cursor");
    expect(botMascotShape(null)).toBe("cursor");
    expect(botMascotShape(42)).toBe("cursor");
  });

  it("exposes a schema that rejects an unknown id", () => {
    expect(mascotShapeSchema.safeParse("star").success).toBe(true);
    expect(mascotShapeSchema.safeParse("nope").success).toBe(false);
  });
});
