import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BotAvatar,
  MausAvatar,
  resolveBotAvatarOutcome,
  type BotAvatarProps,
  type MausAvatarProps,
} from "./Avatar";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";

const render = (props: Partial<MausAvatarProps>) =>
  renderToStaticMarkup(createElement(MausAvatar, { color: "green", animated: false, ...props }));

const renderBot = (bot: Partial<BotAvatarProps["bot"]>) =>
  renderToStaticMarkup(
    createElement(BotAvatar, { bot: { color: "green", ...bot }, animated: false }),
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
    // SAFETY: "hexagram" is deliberately not a valid MascotBodyId — this
    // exercises the runtime schema fallback for a value that could arrive
    // from persisted/streamed data, which the type system would otherwise
    // rule out at this call site.
    expect(render({ bodyId: "hexagram" as MausAvatarProps["bodyId"] })).toContain(
      MASCOT_BODIES.cursor.fit,
    );
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

  it("falls back to the gradient mascot when the crop is face but there is no valid image", () => {
    const markup = renderBot({ avatarUrl: undefined, avatarCrop: "face" });
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<image");
    expect(markup).toContain("<svg");
  });

  it("shows the gradient mascot for a face crop before the load probe resolves, never a broken or empty body", () => {
    // renderToStaticMarkup never runs effects, so this is exactly the state
    // a "face"-crop bot is in for its very first paint, before the
    // background probe has had a chance to confirm the image loads. There
    // must be no flash of a broken <image> here — it should look identical
    // to the "no valid image" fallback above.
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "face" });
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<image");
    expect(markup).toContain("<svg");
  });
});

describe("resolveBotAvatarOutcome", () => {
  // The probe that confirms a "face"-crop image is real runs in a
  // useEffect (a detached Image(), not the painted element), so it cannot
  // resolve inside renderToStaticMarkup — there are no effects to run. The
  // decision is a pure function precisely so this branch is still testable
  // synchronously.
  it("wears the living face once the probe has confirmed the image loads", () => {
    expect(
      resolveBotAvatarOutcome({
        avatarCrop: "face",
        hasUrl: true,
        imageFailed: false,
        livingImageReady: true,
      }),
    ).toBe("livingMascot");
  });

  it("falls back to the gradient mascot for a face crop whose image failed the probe", () => {
    expect(
      resolveBotAvatarOutcome({
        avatarCrop: "face",
        hasUrl: true,
        imageFailed: false,
        livingImageReady: false,
      }),
    ).toBe("gradientMascot");
  });

  it("leaves the flat-crop failure path untouched: imageFailed still forces the gradient mascot", () => {
    expect(
      resolveBotAvatarOutcome({
        avatarCrop: "circle",
        hasUrl: true,
        imageFailed: true,
        livingImageReady: false,
      }),
    ).toBe("gradientMascot");
  });

  it("leaves the flat-crop success path untouched: a good flat image still renders flat", () => {
    expect(
      resolveBotAvatarOutcome({
        avatarCrop: "rounded",
        hasUrl: true,
        imageFailed: false,
        livingImageReady: false,
      }),
    ).toBe("flatImage");
  });
});
