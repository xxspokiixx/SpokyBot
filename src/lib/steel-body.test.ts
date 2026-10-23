import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CHROME_STEEL, metalLayers } from "@/components/ChromeFinish";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";
import { steelBodyImage, type SteelImage } from "./steel-body";

const images: SteelImage[] = [40, 56, 88, 128, 192, 256].map((px) => ({ body: "cursor", px, url: `/steel/cursor-${px}.webp` }));

describe("MausBot's rendered steel body", () => {
  it("picks the smallest image with a device pixel for every pixel drawn, from the popup down to the cursor", () => {
    expect(steelBodyImage("cursor", 20, 2, images)).toBe("/steel/cursor-40.webp");
    expect(steelBodyImage("cursor", 28, 2, images)).toBe("/steel/cursor-56.webp");
    expect(steelBodyImage("cursor", 44, 1, images)).toBe("/steel/cursor-56.webp");
    expect(steelBodyImage("cursor", 96, 2, images)).toBe("/steel/cursor-192.webp");
    expect(steelBodyImage("cursor", 112, 3, images)).toBe("/steel/cursor-256.webp");
    expect(steelBodyImage("cursor", 28, 0, images)).toBe("/steel/cursor-40.webp");
  });

  it("keeps the drawn steel for a body with no images", () => {
    expect(steelBodyImage("circle", 44, 2, images)).toBeNull();
    expect(steelBodyImage("cursor", 44, 2, [])).toBeNull();
  });

  it("draws the image over the whole avatar frame, under the face, with the drawn steel beneath it and no grain filter", () => {
    const svg = (image?: string) => renderToStaticMarkup(createElement("svg", null, metalLayers("m1", MASCOT_BODIES.cursor, CHROME_STEEL, 112, image)));
    const withImage = svg("/steel/cursor-256.webp");
    expect(withImage).toContain('<image href="/steel/cursor-256.webp" x="-15" y="-15" width="258.541" height="258.541" preserveAspectRatio="none"');
    expect(withImage).not.toContain("feTurbulence");
    expect(withImage.indexOf("m1-steel")).toBeLessThan(withImage.indexOf("<image"));
    expect(svg()).toContain("feTurbulence");
    expect(svg()).not.toContain("<image");
  });
});
