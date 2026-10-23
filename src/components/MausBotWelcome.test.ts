import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { StoreProvider, type Bot, type Message } from "@/state/store";
import { HelperIntro } from "./HelperIntro";
import { setupAction } from "./HelperSetup";
import { mausBotWelcomeDue, welcomePatch } from "./MausBotWelcome";

const maus = { name: "MausBot", color: "chrome", mascotBody: null } as Pick<Bot, "name" | "color" | "mascotBody">;

describe("MausBot's first-launch welcome", () => {
  it("shows once, after onboarding and its tour, and never again after either choice", () => {
    const due = (bot: Pick<Bot, "welcomed" | "hidden"> | undefined, more: Partial<Parameters<typeof mausBotWelcomeDue>[0]> = {}) =>
      mausBotWelcomeDue({ bot, onboardingDue: false, welcomeOpen: false, tourOpen: false, ...more });
    expect(due({})).toBe(true);
    expect(due({ welcomed: true })).toBe(false);
    expect(due({}, { onboardingDue: true })).toBe(false);
    expect(due({}, { welcomeOpen: true })).toBe(false);
    expect(due({}, { tourOpen: true })).toBe(false);
    expect(due(undefined)).toBe(false);
    expect(due({ hidden: true })).toBe(false);
  });

  it("Add saves the person's changes, pins MausBot and keeps it in the sidebar", () => {
    expect(welcomePatch(maus, { name: " Jarvis ", color: "blue", mascotBody: "blob" }, true))
      .toEqual({ name: "Jarvis", color: "blue", mascotBody: "blob", welcomed: true, sidebarHidden: false, pinned: true });
  });

  it("Not now turns Show MausBot in the sidebar off, keeping what was changed, and nothing unchanged is sent", () => {
    expect(welcomePatch(maus, { name: "MausBot", color: "chrome", mascotBody: "cursor" }, false)).toEqual({ welcomed: true, sidebarHidden: true });
    expect(welcomePatch(maus, { name: "", color: "chrome", mascotBody: "star" }, false)).toEqual({ mascotBody: "star", welcomed: true, sidebarHidden: true });
  });
});

describe("MausBot's intro in the chat", () => {
  const intro: Message = { id: "intro", role: "bot", kind: "options", at: 1, helperIntro: true, text: "Hi, I'm MausBot.",
    card: { title: "Hi, I'm MausBot, your helper for everything here.", subtitle: "", options: ["What are my bots up to?"] } };
  const render = (asksDone: boolean) => renderToStaticMarkup(createElement(StoreProvider, null,
    createElement(HelperIntro, { botId: "maus", threadId: "t1", message: intro, asksDone })));

  it("says who it is in the viewer's language, with asks and, on a fresh install, only the setup still to do", () => {
    const html = render(false);
    expect(html).toContain(t("helperIntro.title", { name: "MausBot" }).replace("'", "&#x27;"));
    expect(html).toContain('data-helper-ask="helperIntro.ask.overview"');
    for (const step of ["ai", "bots", "apps", "phone", "cloud"]) expect(html).toContain(`data-helper-step="${step}"`);
  });

  it("drops the asks and setup once they were answered or dismissed, keeping what it said", () => {
    const html = render(true);
    expect(html).toContain('data-helper-intro="intro"');
    expect(html).not.toContain("data-helper-ask");
    expect(html).not.toContain("data-helper-step");
  });

  it("opens the app's own flow for each setup step", () => {
    expect(setupAction("ai")).toEqual({ type: "toggleAppSettings", open: true, section: "engines" });
    expect(setupAction("bots")).toEqual({ type: "toggleNewBot", open: true });
    expect(setupAction("apps")).toEqual({ type: "togglePlugins", open: true, surface: "apps" });
    expect(setupAction("phone")).toMatchObject({ type: "toggleAppSettings", section: "companion", phonePairing: true });
    expect(setupAction("cloud")).toEqual({ type: "openCloudAdd", source: "app_onboarding" });
  });
});
