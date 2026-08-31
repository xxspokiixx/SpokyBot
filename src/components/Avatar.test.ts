import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BotAvatar, MausAvatar } from "./Avatar";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(MausAvatar, { color: "green", animated: false, ...props } as never));

const renderBot = (bot: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(BotAvatar, { bot: { color: "green", ...bot }, animated: false } as never),
  );

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

describe("MausAvatar living image", () => {
  it("wears the image when the bot is in face mode", () => {
    const markup = render({ bodyId: "circle", bodyImage: "/api/attachments/cat.webp" });
    expect(markup).toContain("<image");
    expect(markup).toContain("/api/attachments/cat.webp");
  });

  it("keeps the gradient body when there is no image", () => {
    expect(render({ bodyId: "circle" })).not.toContain("<image");
  });
});

describe("BotAvatar's three avatar outcomes", () => {
  it("renders a flat cropped image for circle/rounded/square, with no mascot at all", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain("<image");
  });

  it("wears the living face when the crop is face and the image is valid", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "face" });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("<image");
    expect(markup).toContain("/api/attachments/cat.webp");
  });

  it("falls back to the gradient mascot when the crop is face but there is no valid image", () => {
    const markup = renderBot({ avatarUrl: undefined, avatarCrop: "face" });
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<image");
    expect(markup).toContain("<svg");
  });
});
