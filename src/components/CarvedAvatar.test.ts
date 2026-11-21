import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CarvedAvatar, REST_POSE, carvedFills, carvedGeometry } from "./CarvedAvatar";
import { MausAvatar } from "./Avatar";
import { HALLOWEEN_BODIES, HALLOWEEN_BODY_IDS } from "../../shared/halloween-bodies";
import { POKEMON_BODY_IDS } from "../../shared/pokemon-bodies";
import { MAUS_COLORS } from "@/lib/mascot";

const POKEMON_COLORS = { charmander: "#f0883e" } as const;

const render = (body: (typeof HALLOWEEN_BODY_IDS)[number], color: "orange" | "purple" = "orange") =>
  renderToStaticMarkup(createElement(CarvedAvatar, { body, color, animated: false, label: body }));

describe("CarvedAvatar", () => {
  it("draws every part, two eyes, and a smile unless the drawing has its own mouth", () => {
    for (const id of HALLOWEEN_BODY_IDS) {
      const markup = render(id);
      const body = HALLOWEEN_BODIES[id];
      expect(markup).toContain(`data-carved-body="${id}"`);
      expect(markup.match(/<rect /g)?.length, id).toBe(2);
      expect(markup.match(/<path /g)?.length, id).toBe(body.parts.length + 1 + (body.eyes.mouth ? 1 : 0));
      expect(markup.includes("<ellipse"), id).toBe(body.eyes.mouth);
    }
  });

  it("is what MausAvatar wears for a Halloween body", () => {
    const markup = renderToStaticMarkup(createElement(MausAvatar, { color: "orange", bodyId: "pumpkin", animated: false }));
    expect(markup).toContain('data-carved-body="pumpkin"');
    expect(markup).not.toContain("linearGradient");
  });

  it("fills flat with the bot's colour, pale for the ghost, bone for the skull", () => {
    expect(render("pumpkin")).not.toContain("linearGradient");
    expect(carvedFills(HALLOWEEN_BODIES.pumpkin, "orange").body).not.toBe(MAUS_COLORS.orange);
    expect(carvedFills(HALLOWEEN_BODIES.ghost, "purple").body).toMatch(/^#[e-f]/);
    expect(carvedFills(HALLOWEEN_BODIES.skull, "purple").body).toBe(HALLOWEEN_BODIES.skull.bone);
  });

  it("opens round eyes and an open mouth when startled", () => {
    const body = HALLOWEEN_BODIES.pumpkin;
    const rest = carvedGeometry(body, REST_POSE);
    const wide = carvedGeometry(body, { ...REST_POSE, wide: 1 });
    expect(rest.eyes[0].height).toBeGreaterThan(rest.eyes[0].width * 1.5);
    expect(Math.abs(wide.eyes[0].height - wide.eyes[0].width)).toBeLessThan(body.eyes.round * 0.1);
    expect(rest.smile.opacity).toBe(1);
    expect(wide.smile.opacity).toBe(0);
    expect(wide.open.opacity).toBe(1);
  });

  it("closes the eyes and follows the gaze", () => {
    const body = HALLOWEEN_BODIES.cat;
    const shut = carvedGeometry(body, { ...REST_POSE, shut: 1 });
    expect(shut.eyes[0].height).toBeLessThan(body.eyes.h * 0.15);
    const left = carvedGeometry(body, { ...REST_POSE, gx: -1 });
    const rest = carvedGeometry(body, REST_POSE);
    expect(left.eyes[0].x).toBeLessThan(rest.eyes[0].x);
    expect(left.body).toContain("rotate(9)");
  });
});

describe("a Pokémon body", () => {
  it("draws its own parts and the same carved face", () => {
    const markup = renderToStaticMarkup(createElement(MausAvatar, { color: "orange", bodyId: "pikachu", animated: false }));
    expect(markup).toContain('data-carved-body="pikachu"');
    // Its two ears, body and two cheek marks, plus the clip path and the smile the face adds.
    expect(markup.match(/<path /g)?.length).toBe(7);
    expect(markup.match(/<rect /g)?.length).toBe(2);
    expect(markup).not.toContain("linearGradient");
  });

  it("keeps the species colour rather than the bot's", () => {
    const markup = renderToStaticMarkup(createElement(MausAvatar, { color: "teal", bodyId: "charmander", animated: false }));
    expect(markup).toContain(POKEMON_COLORS.charmander);
    expect(markup).not.toContain(MAUS_COLORS.teal);
  });

  it("draws every one of the 151 without throwing", () => {
    for (const id of POKEMON_BODY_IDS) {
      const markup = renderToStaticMarkup(createElement(MausAvatar, { color: "green", bodyId: id, animated: false }));
      expect(markup, id).toContain(`data-carved-body="${id}"`);
      expect(markup.match(/<rect /g)?.length, id).toBe(2);
    }
  });
});
