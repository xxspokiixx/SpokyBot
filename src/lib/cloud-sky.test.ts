import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8").replace(/\r\n/g, "\n");
/** The rule whose whole selector is `selector`, not one it ends a selector list of. */
const body = (selector: string) => {
  let start = css.indexOf(`\n${selector} {`);
  while (start > 0 && css[start - 1] === ",") start = css.indexOf(`\n${selector} {`, start + 1);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
};
const list = (rule: string, property: string) => (new RegExp(`${property}: ([^;]+);`).exec(rule)?.[1] ?? "").split(/,(?![^(]*\))/).map((part) => part.trim());

describe("a Cloud's own sidebar sky", () => {
  it("draws 5 to 7 small stars over the sidebar and fewer on the rail, each with its own place, one of them twinkling", () => {
    for (const [variant, least, most] of [["simple", 5, 7], ["advanced", 5, 7], ["rail", 3, 5]] as const) {
      const rule = body(`[data-cloud-sky="${variant}"]::after`);
      const stars = list(rule, "background-image"), places = list(rule, "background-position");
      expect(stars.length, variant).toBeGreaterThanOrEqual(least);
      expect(stars.length, variant).toBeLessThanOrEqual(most);
      expect(places, variant).toHaveLength(stars.length);
      expect(new Set(places).size, `${variant}: no two stars in one place`).toBe(places.length);
      expect(stars.filter((star) => star === "var(--twinkle)"), variant).toHaveLength(1);
    }
  });

  it("keeps every star tiny and faint", () => {
    const after = body("[data-cloud-sky]::after");
    for (const name of ["star", "faint", "bright", "twinkle"]) {
      const star = new RegExp(`--${name}: radial-gradient\\(circle ([\\d.]+)px, color-mix\\(in srgb, var\\(--cloud-sky-star\\) ([^,]+), transparent\\)`).exec(after);
      expect(star, name).not.toBeNull();
      expect(Number(star![1]), `${name} radius`).toBeLessThanOrEqual(1.5);
      if (name !== "twinkle") {
        expect(Number.parseFloat(star![2]!), `${name} strength`).toBeGreaterThanOrEqual(25);
        expect(Number.parseFloat(star![2]!), `${name} strength`).toBeLessThanOrEqual(45);
      }
    }
  });

  it("twinkles one star rarely and softly, and never under reduced motion, the system's or the app's", () => {
    const [, seconds] = /animation: cloud-sky-twinkle ([\d.]+)s/.exec(body("[data-cloud-sky]::after")) ?? [];
    expect(Number(seconds)).toBeGreaterThanOrEqual(20);
    expect(Number(seconds)).toBeLessThanOrEqual(40);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-cloud-sky\]::after \{ animation: none; \}/);
    expect(css).toContain(':root[data-reduced-motion="true"] [data-cloud-sky]::after { animation: none; }');
  });

  it("takes no pointer and holds no focus or words: both layers are empty pseudo-elements", () => {
    const layers = body("[data-cloud-sky]::before,\n[data-cloud-sky]::after");
    expect(layers).toContain('content: "";');
    expect(layers).toContain("pointer-events: none;");
  });

  it("is gone before the first bot: at most 120px tall, its wash fading to nothing", () => {
    for (const selector of ["[data-cloud-sky]::before,\n[data-cloud-sky]::after", '[data-cloud-sky="rail"]::before,\n[data-cloud-sky="rail"]::after']) {
      const [, height] = /height: (\d+)px;/.exec(body(selector)) ?? [];
      expect(Number(height), selector).toBeLessThanOrEqual(120);
    }
    expect(body("[data-cloud-sky]::before")).toMatch(/mask-image: linear-gradient\(to bottom, [^;]*transparent \d+%\);/);
  });
});
