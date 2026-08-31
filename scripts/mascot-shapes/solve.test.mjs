import { describe, expect, it } from "vitest";

import { maskFromPolylines } from "./raster.ts";
import { fieldFromMask, largestInscribedCircle, sampleSdf } from "./sdf.ts";
import { buildClouds, report, solveFit } from "./solve.ts";

const FACE_BOX = 228.541;
const SIZE = 256;

const circle = (r, steps = 512) => {
  const c = FACE_BOX / 2;
  const points = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    points.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  return [points];
};

const fieldFor = (r) => fieldFromMask(maskFromPolylines(circle(r), SIZE), SIZE);

describe("sdf", () => {
  it("is positive inside, negative outside, and zero on the edge", () => {
    const sdf = fieldFor(80);
    const c = FACE_BOX / 2;
    expect(sampleSdf(sdf, c, c)).toBeGreaterThan(70);
    expect(sampleSdf(sdf, c + 100, c)).toBeLessThan(0);
    expect(Math.abs(sampleSdf(sdf, c + 80, c))).toBeLessThan(3);
  });

  it("finds the centre of a circle as its largest inscribed circle", () => {
    const found = largestInscribedCircle(fieldFor(80));
    expect(found.x).toBeCloseTo(FACE_BOX / 2, 0);
    expect(found.y).toBeCloseTo(FACE_BOX / 2, 0);

    // A pixel-sampled field cannot resolve the radius exactly: FACE_BOX/2 lands on a
    // pixel corner at SIZE=256, so the best-placed pixel centre sits ~0.7px off the
    // true centre, and the EDT measures to outside pixel CENTRES rather than to the
    // true edge. The shortfall is ~0.6px (~0.55 units) at every radius tested.
    expect(found.radius).toBeGreaterThan(79);
    // The direction matters more than the magnitude, which is what the original
    // tolerance failed to capture: an OVER-estimate would report clearance the shape
    // does not have and let a face clip its own body. An under-estimate only costs a
    // slightly smaller face — the safe side to be wrong on.
    expect(found.radius).toBeLessThanOrEqual(80);
  });
});

describe("solveFit", () => {
  it("fits a full-size face in a roomy circle", () => {
    const fit = solveFit(fieldFor(100), 0);
    expect(fit.clipping).toEqual([]);
    expect(fit.anchor.scale).toBeGreaterThan(0.8);
  });

  it("shrinks the face rather than clipping it in a tight circle", () => {
    const roomy = solveFit(fieldFor(100), 0);
    const tight = solveFit(fieldFor(55), 0);
    expect(tight.clipping).toEqual([]);
    expect(tight.anchor.scale).toBeLessThan(roomy.anchor.scale);
  });

  it("never exceeds the scale the expressions were drawn for", () => {
    expect(solveFit(fieldFor(110), 0).anchor.scale).toBeLessThanOrEqual(1);
  });

  it("agrees with report at the anchor it returned", () => {
    const sdf = fieldFor(90);
    const fit = solveFit(sdf, 0);
    expect(report(buildClouds(0), sdf, fit.anchor).clipping).toEqual([]);
  });

  it("reports clipping when a face is forced too large", () => {
    const sdf = fieldFor(55);
    const forced = { ...solveFit(sdf, 0).anchor, scale: 1 };
    expect(report(buildClouds(0), sdf, forced).clipping.length).toBeGreaterThan(0);
  });
});
