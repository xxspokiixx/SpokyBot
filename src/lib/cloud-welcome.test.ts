import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudMoveOverview } from "../../electron/cloud-move.mjs";
import {
  ABOUT_ME_LIMIT, cloudFirstRun, cloudWelcomeShown, copyPossible, endWelcomeHere, hasWork, markWelcomeSeen, memoryKept, noteWelcomeHints, pendingMemory,
  rememberPendingMemory, resetCloudWelcome, returnToWelcome, stepAsideWelcome, suggestedChoice, takeWelcomeRequest, useCloudWelcome,
  welcomeCredit, withEarlyHints, withMemory,
} from "./cloud-welcome";
import { EMPTY_ONBOARDING } from "./onboarding";

const local = { bots: 6, rooms: 1, chats: 142, bytes: 1.2 * 1024 ** 3, files: 900, routines: 4 };
const emptyCloud = { contents: { bots: 1, rooms: 0, chats: 0 }, empty: true, freeBytes: 9 * 1024 ** 3, previous: null, heldBytes: 0 };
const CLOUD = { id: "cloud", name: "My Cloud", origin: "https://omb-u-1a2b3c4d5e6f.fly.dev", kind: "cloud" as const };
const overview = (extra: Partial<CloudMoveOverview> = {}): CloudMoveOverview => ({
  phase: "idle", local, cloud: emptyCloud, suggest: true, destination: CLOUD, blocked: null, fit: { fit: "now", neededBytes: 1, freeBytes: 2 }, ...extra,
});

beforeEach(() => { resetCloudWelcome(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("cloudFirstRun", () => {
  it("opens the welcome before anything that can start a chat: the first-job question and a job waiting for the sign-in", () => {
    expect(cloudFirstRun({ welcome: true, intent: true, signIn: true })).toBe("welcome");
    expect(cloudFirstRun({ welcome: true, intent: false, signIn: true })).toBe("welcome");
    expect(cloudFirstRun({ welcome: false, intent: true, signIn: true })).toBe("intent");
    expect(cloudFirstRun({ welcome: false, intent: false, signIn: true })).toBe("sign-in");
    expect(cloudFirstRun({ welcome: false, intent: false, signIn: false })).toBeNull();
  });
});

describe("bringing this computer's stuff", () => {
  it("offers the copy first, while the Cloud is empty, even after its one-time card was put off", () => {
    expect(copyPossible(overview())).toBe(true);
    expect(copyPossible(overview({ suggest: false }))).toBe(true);
    expect(suggestedChoice(true, overview({ suggest: false }))).toBe("copy");
  });

  it("does not offer it once the Cloud has bots or chats of its own: a copy from here never replaces them", () => {
    const busy = overview({ cloud: { ...emptyCloud, contents: { bots: 1, rooms: 0, chats: 1 }, empty: false } });
    expect(copyPossible(busy)).toBe(false);
    expect(suggestedChoice(true, busy)).toBe("fresh");
  });

  it("starts fresh by default when this computer has nothing to bring, the copy can't run, or would not fit", () => {
    expect(hasWork({ ...local, bots: 1, rooms: 0, chats: 0 })).toBe(false);
    expect(hasWork(local)).toBe(true);
    expect(hasWork(null)).toBe(false);
    expect(suggestedChoice(true, overview({ local: { ...local, bots: 1, rooms: 0, chats: 0 } }))).toBe("fresh");
    expect(suggestedChoice(true, overview({ blocked: "outdated" }))).toBe("fresh");
    expect(suggestedChoice(true, overview({ fit: { fit: "never", neededBytes: 2, freeBytes: 1 } }))).toBe("fresh");
    expect(copyPossible(overview({ destination: null }))).toBe(false);
  });

  it("assumes the copy until this computer has answered, and offers only a fresh start outside the desktop app", () => {
    expect(suggestedChoice(true, null)).toBe("copy");
    expect(suggestedChoice(false, overview())).toBe("fresh");
    expect(suggestedChoice(false, null)).toBe("fresh");
  });
});

describe("welcomeCredit", () => {
  it("names the amount left where the desktop app's plan says it, and still says there is credit without it", () => {
    const plan = { status: "paid" as const, credit: { grantedUsd: 5, remainingUsd: 4.2, state: "active" as const } };
    expect(welcomeCredit([{ trialCredit: "active" }], plan)).toEqual({ state: "active", left: 4.2 });
    expect(welcomeCredit([{ trialCredit: "active" }], null)).toEqual({ state: "active", left: null });
    expect(welcomeCredit([{}], plan)).toEqual({ state: "active", left: 4.2 });
  });

  it("says when the credit is spent or gone, and is quiet without one", () => {
    expect(welcomeCredit([{ trialCredit: "used_up" }], null)).toEqual({ state: "used_up" });
    expect(welcomeCredit([{ trialCredit: "ended" }], null)).toEqual({ state: "ended" });
    expect(welcomeCredit([{}], { status: "paid", credit: { grantedUsd: 5, remainingUsd: 0, state: "used_up" } })).toEqual({ state: "used_up" });
    expect(welcomeCredit([{}], null)).toBeNull();
    expect(welcomeCredit([], { status: "paid" })).toBeNull();
  });
});

describe("memory from Claude or ChatGPT", () => {
  it("is added to the end of About me, after a blank line", () => {
    expect(withMemory("I run a studio.\n", "  - Lives in Berlin\n- Likes tea  ")).toBe("I run a studio.\n\n- Lives in Berlin\n- Likes tea");
    expect(withMemory(undefined, "- Likes tea")).toBe("- Likes tea");
    expect(withMemory("Kept.", "   ")).toBe("Kept.");
    expect(memoryKept("I run a studio.\n\n- Likes tea", " - Likes tea ")).toBe(true);
    expect(memoryKept("This computer's own About me", "- Likes tea")).toBe(false);
    expect(ABOUT_ME_LIMIT).toBe(24_000);
  });

  it("waits on this device until the copy lands, since a copy brings this computer's About me", () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); },
      removeItem: (key: string) => { saved.delete(key); },
    });
    expect(pendingMemory()).toBeNull();
    rememberPendingMemory("  - Likes tea  ");
    expect(pendingMemory()).toBe("- Likes tea");
    rememberPendingMemory(null);
    expect(pendingMemory()).toBeNull();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} });
    expect(() => rememberPendingMemory("- Likes tea")).not.toThrow();
    expect(pendingMemory()).toBeNull();
  });
});

describe("the welcome in this session", () => {
  const read = async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    let value: ReturnType<typeof useCloudWelcome> | null = null;
    function Probe() { value = useCloudWelcome(); return null; }
    renderToStaticMarkup(createElement(Probe));
    return value!;
  };

  it("shows while pending, steps aside when the person leaves it, and comes back where Continue setup asks", async () => {
    expect(cloudWelcomeShown("pending", await read())).toBe(true);
    stepAsideWelcome();
    expect(cloudWelcomeShown("pending", await read())).toBe(false);
    returnToWelcome("engine");
    expect(cloudWelcomeShown("pending", await read())).toBe(true);
    expect(takeWelcomeRequest()).toBe("engine");
    expect(takeWelcomeRequest()).toBeNull();
  });

  it("goes the moment it is done or skipped, before the Cloud's record says so", async () => {
    endWelcomeHere();
    expect(cloudWelcomeShown("pending", await read())).toBe(false);
  });

  it("stays on screen while the Cloud restarts under it once it was shown, and never shows on any other stage", async () => {
    expect(cloudWelcomeShown("waiting", await read())).toBe(false);
    markWelcomeSeen();
    expect(cloudWelcomeShown("waiting", await read())).toBe(true);
    for (const stage of ["none", "ended"]) expect(cloudWelcomeShown(stage, await read())).toBe(false);
  });

  it("counts hints written here before the Cloud's record has them", () => {
    noteWelcomeHints(["cloud-welcome-bring"]);
    noteWelcomeHints(["cloud-welcome-bring", "cloud-setup-move-skipped"]);
    const record = { ...EMPTY_ONBOARDING, hintsSeen: ["tour.composer"] };
    expect(withEarlyHints(record, ["cloud-welcome-bring"])?.hintsSeen).toEqual(["tour.composer", "cloud-welcome-bring"]);
    expect(withEarlyHints(record, [])).toBe(record);
    expect(withEarlyHints(undefined, ["cloud-welcome-bring"])).toBeUndefined();
  });
});
