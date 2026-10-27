import { describe, expect, it } from "vitest";

import { APP_FACES, POPULAR_APPS, appFaces } from "./SidebarConnectApps";

const card = (slug: string) => ({ slug, label: slug, logo: `https://logos.example/${slug}.png`, domain: null });

describe("the Connect apps faces", () => {
  it("shows popular apps until something is connected", () => {
    expect(appFaces([], new Map()).map((face) => face.slug)).toEqual(POPULAR_APPS.map((app) => app.slug));
  });

  it("puts connected apps first, fills with popular ones, and never shows more than three", () => {
    const cards = new Map([["github", card("github")], ["gmail", card("gmail")]]);
    expect(appFaces(["github", "gmail"], cards).map((face) => face.slug)).toEqual(["github", "gmail", "slack"]);
    const many = new Map(["a", "b", "c", "d"].map((slug) => [slug, card(slug)]));
    expect(appFaces(["a", "b", "c", "d"], many)).toHaveLength(APP_FACES);
  });

  it("keeps a connected app it cannot draw yet out, and the popular ones in", () => {
    expect(appFaces(["linear"], new Map()).map((face) => face.slug)).toEqual(["gmail", "slack", "notion"]);
  });
});
