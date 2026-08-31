import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MausAvatar } from "./Avatar";
import { MASCOT_SHAPES } from "../../shared/mascot-shapes";

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(MausAvatar, { color: "green", animated: false, ...props } as never));

describe("MausAvatar shape", () => {
  it("wears the cursor when no shape is given", () => {
    expect(render({})).toContain(MASCOT_SHAPES.cursor.fit);
  });

  it("wears the shape it is given", () => {
    const markup = render({ shape: "star" });
    expect(markup).toContain(MASCOT_SHAPES.star.fit);
  });

  it("falls back to the cursor for an unknown shape", () => {
    expect(render({ shape: "hexagram" })).toContain(MASCOT_SHAPES.cursor.fit);
  });

  it("paints the body with the per-bot gradient, never a flat black fill", () => {
    const markup = render({ shape: "circle" });
    expect(markup).not.toContain('fill="#000000"');
    expect(markup).not.toContain("{{GRADIENT}}");
    expect(markup).toContain("url(#");
  });
});
