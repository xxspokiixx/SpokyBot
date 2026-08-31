import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CursorAvatar, DEFAULT_SILHOUETTE } from "./CursorAvatar";

const render = (silhouette: unknown) =>
  renderToStaticMarkup(
    createElement(CursorAvatar, { silhouette, animated: false } as never),
  );

describe("CursorAvatar body", () => {
  it("paints a gradient when there is no image", () => {
    const markup = render(DEFAULT_SILHOUETTE);
    expect(markup).not.toContain("<image");
    expect(markup).toContain("linearGradient");
  });

  it("paints the image, clipped to the silhouette, when there is one", () => {
    const markup = render({
      ...DEFAULT_SILHOUETTE,
      bodyImage: "/api/attachments/cat.webp",
    });
    expect(markup).toContain("<image");
    expect(markup).toContain("/api/attachments/cat.webp");
    expect(markup).toContain('preserveAspectRatio="xMidYMid slice"');
  });

  it("scrims the image so a white face stays readable on a pale picture", () => {
    const markup = render({ ...DEFAULT_SILHOUETTE, bodyImage: "/api/attachments/cat.webp" });
    expect(markup).toContain("radialGradient");
  });

  it("escapes the image URL instead of interpolating it as markup", () => {
    const markup = render({
      ...DEFAULT_SILHOUETTE,
      bodyImage: '/api/attachments/x.webp"/><script>alert(1)</script>',
    });
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });
});
