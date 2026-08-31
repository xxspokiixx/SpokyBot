import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MausAvatar } from "./Avatar";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(MausAvatar, { color: "green", animated: false, ...props } as never));

describe("MausAvatar body", () => {
  it("wears the cursor when no body is given", () => {
    expect(render({})).toContain(MASCOT_BODIES.cursor.fit);
  });

  it("wears the body it is given", () => {
    const markup = render({ bodyId: "star" });
    expect(markup).toContain(MASCOT_BODIES.star.fit);
  });

  it("falls back to the cursor for an unknown body", () => {
    expect(render({ bodyId: "hexagram" })).toContain(MASCOT_BODIES.cursor.fit);
  });

  it("paints the body with the per-bot gradient, never a flat black fill", () => {
    const markup = render({ bodyId: "circle" });
    expect(markup).not.toContain('fill="#000000"');
    expect(markup).not.toContain("{{GRADIENT}}");
    expect(markup).toContain("url(#");
  });
});
