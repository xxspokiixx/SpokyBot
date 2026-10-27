import { describe, expect, it } from "vitest";

import { chiefChoices, chiefFor, createChiefPatch, hiddenFromSidebar, myDefaultBot, setupSteps, someoneElsesDefaultBot } from "./default-bot";
import { partitionSidebarBots } from "./sidebar-layout";
import type { DefaultBotFields } from "../../shared/default-bot";

const bot = (id: string, fields: DefaultBotFields = {}): DefaultBotFields & { id: string } => ({ id, ...fields });

describe("MausBot in the sidebar", () => {
  it("leaves out a MausBot whose Show switch is off, and on a Team Cloud other people's, but keeps the viewer's own", () => {
    const bots = [
      bot("maus", { defaultBot: {} }),
      bot("ada-maus", { defaultBot: { person: "ada@example.com" } }),
      bot("bea-maus", { defaultBot: { person: "bea@example.com" } }),
      bot("writer"),
    ];
    const shown = (viewerEmail: string | null) => partitionSidebarBots(bots, { viewerEmail }).unsectionedBots.map((entry) => entry.id);
    expect(shown("ada@example.com")).toEqual(["maus", "ada-maus", "writer"]);
    expect(shown(null)).toEqual(["maus", "writer"]);
    bots[0] = bot("maus", { defaultBot: {}, sidebarHidden: true });
    expect(shown(null)).toEqual(["writer"]);
    expect(hiddenFromSidebar(bots[0]!, null)).toBe(true);
    expect(someoneElsesDefaultBot(bots[2]!, "ADA@example.com".toLowerCase())).toBe(true);
  });

  it("finds the viewer's own MausBot: their own on a team, the place's otherwise, none until the viewer is known", () => {
    const team = [bot("ada-maus", { defaultBot: { person: "ada@example.com" } }), bot("writer")];
    expect(myDefaultBot(team, undefined)).toBeUndefined();
    expect(myDefaultBot(team, "ada@example.com")?.id).toBe("ada-maus");
    expect(myDefaultBot(team, "bea@example.com")).toBeUndefined();
    const place = [bot("writer"), bot("maus", { defaultBot: {} })];
    expect(myDefaultBot(place, null)?.id).toBe("maus");
    expect(myDefaultBot(place, "owner@example.com")?.id).toBe("maus");
  });
});

describe("MausBot's identity is its mark, never its name", () => {
  it("keeps finding a renamed MausBot for the Settings switch and the sidebar, and keeps it out of the list while its welcome is open", () => {
    const bots = [bot("writer"), { ...bot("maus", { defaultBot: {} }), name: "Jarvis" }];
    expect(myDefaultBot(bots, null)?.id).toBe("maus");
    expect(partitionSidebarBots(bots, { viewerEmail: null }).unsectionedBots.map((entry) => entry.id)).toEqual(["writer", "maus"]);
    expect(partitionSidebarBots(bots, { viewerEmail: null, welcoming: "maus" }).unsectionedBots.map((entry) => entry.id)).toEqual(["writer"]);
  });
});

describe("what MausBot offers to set up", () => {
  const fresh = { aiReady: false, ownBots: 0, onCloud: false, team: false, remote: false };

  it("on a fresh install, only what its look around found missing, an AI first", () => {
    expect(setupSteps(fresh)).toEqual(["ai", "apps", "bots", "phone", "cloud"]);
    expect(setupSteps({ ...fresh, aiReady: true, appsConnected: true })).toEqual(["bots", "phone", "cloud"]);
    expect(setupSteps({ ...fresh, aiReady: true, phonePaired: true, onCloud: true })).toEqual(["apps", "bots"]);
    expect(setupSteps({ ...fresh, aiReady: true, remote: true })).toEqual(["apps", "bots", "phone"]);
  });

  it("offers to bring in skills only where this computer has some", () => {
    expect(setupSteps({ ...fresh, aiReady: true, importFound: true })).toEqual(["apps", "bots", "phone", "cloud", "import"]);
    expect(setupSteps({ ...fresh, aiReady: true, importFound: false })).not.toContain("import");
  });

  it("never nags a person who is set up, nor a Team Cloud member", () => {
    expect(setupSteps({ ...fresh, aiReady: true, ownBots: 3, importFound: true })).toEqual([]);
    expect(setupSteps({ ...fresh, ownBots: 3 })).toEqual(["ai"]);
    expect(setupSteps({ ...fresh, team: true })).toEqual([]);
  });
});

describe("who becomes the Chief of Staff on the first run", () => {
  type Candidate = { id: string; defaultBot?: { person?: string }; chiefOfStaff?: boolean; section?: string; hidden?: boolean };
  const maus: Candidate = { id: "maus", defaultBot: {}, chiefOfStaff: true };
  const research: Candidate = { id: "research" };

  it("finds the Chief in MausBot's own department, never a department's or a hidden one", () => {
    expect(chiefFor([maus, research], maus)?.id).toBe("maus");
    expect(chiefFor([{ ...maus, chiefOfStaff: false }, { ...research, chiefOfStaff: true }], maus)?.id).toBe("research");
    expect(chiefFor([{ ...maus, chiefOfStaff: false }, { id: "sales", section: "Sales", chiefOfStaff: true }], maus)).toBeUndefined();
    expect(chiefFor([{ ...maus, chiefOfStaff: false }, { id: "old", chiefOfStaff: true, hidden: true }], maus)).toBeUndefined();
  });

  it("offers the person's own bots there to choose from, never MausBot, a hidden bot or someone else's", () => {
    const bots: Candidate[] = [maus, research, { id: "sales", section: "Sales" }, { id: "gone", hidden: true }, { id: "ada-maus", defaultBot: { person: "ada@example.com" } }];
    expect(chiefChoices(bots, maus, null).map((bot) => bot.id)).toEqual(["research"]);
    expect(chiefChoices([maus], maus, null)).toEqual([]);
  });

  it("Create makes MausBot the Chief only where there is none, and never takes the role from a Chief someone has", () => {
    expect(createChiefPatch({ defaultBot: {} }, undefined)).toEqual({ welcomed: true, chiefOfStaff: true });
    expect(createChiefPatch({ defaultBot: {} }, maus)).toEqual({ welcomed: true });
    expect(createChiefPatch({ defaultBot: {}, sidebarHidden: true }, maus), "back in the sidebar").toEqual({ welcomed: true, sidebarHidden: false });
  });
});
