// Where a turn's hands land. The policy is small but every branch was a
// real confusion: a browser-only bot that still got a computer, an Auto
// task that hopped surfaces between turns, a plea that named no place.
import { describe, expect, it } from "vitest";

import {
  parseSurface,
  resolveSurface,
  surfaceForTool,
  surfaceOfComputerKind,
  surfacePrompt,
} from "./surface.ts";

describe("resolveSurface", () => {
  it("browser destination mounts only the built-in browser", () => {
    expect(resolveSurface({ destination: "browser", browserOn: true })).toEqual({
      computer: "off",
      browser: true,
      pinned: null,
      clearPin: false,
      note: "",
    });
  });

  it("browser destination with the browser switched off mounts nothing and says so", () => {
    const plan = resolveSurface({ destination: "browser", browserOn: false });
    expect(plan.computer).toBe("off");
    expect(plan.browser).toBe(false);
    expect(plan.note).toMatch(/switched off in App Settings/);
    expect(plan.note).toMatch(/no browser and no computer/);
  });

  it("a computer destination mounts only that computer: one place per turn", () => {
    for (const destination of ["cloud", "vm", "local"] as const) {
      // the bot's browser switch no longer adds a second place next to a computer
      expect(resolveSurface({ destination, browserOn: true })).toEqual({ computer: destination, browser: false, pinned: null, clearPin: false, note: "" });
      expect(resolveSurface({ destination, browserOn: false })).toMatchObject({ computer: destination, browser: false });
    }
  });

  it("Off mounts no computer and no browser, and says which setting did it", () => {
    const plan = resolveSurface({ destination: "off", browserOn: true });
    expect(plan).toMatchObject({ computer: "off", browser: false, pinned: null, clearPin: false });
    expect(plan.note).toMatch(/"Works on" setting is Off/);
    expect(plan.note).toMatch(/no computer and no built-in browser/);
    // the same whether or not a browser could have been mounted
    expect(resolveSurface({ destination: "off", browserOn: false })).toEqual(plan);
    // nothing mounted, so the surface paragraph stays silent and only the
    // note tells the model why it has no screen
    expect(surfacePrompt({ computer: null, browser: false }, { note: plan.note })).toBe(plan.note);
  });

  it("Off is the one setting a conversation pin cannot override", () => {
    expect(resolveSurface({ destination: "off", pinnedSurface: "browser", browserOn: true }))
      .toMatchObject({ computer: "off", browser: false, pinned: null, clearPin: false });
    expect(resolveSurface({ destination: "off", pinnedSurface: "cloud", browserOn: true }))
      .toMatchObject({ computer: "off", browser: false, pinned: null, clearPin: false });
  });

  it("a conversation pin wins over the bot's default, whatever that default is", () => {
    // pinned to the browser from the composer while the bot defaults to a computer
    expect(resolveSurface({ destination: "cloud", pinnedSurface: "browser", browserOn: true }))
      .toEqual({ computer: "off", browser: true, pinned: "browser", clearPin: false, note: "" });
    // pinned to a computer while the bot is browser-only or on Auto
    for (const destination of ["browser", undefined] as const) {
      for (const pin of ["cloud", "vm", "local"] as const) {
        expect(resolveSurface({ destination, pinnedSurface: pin, browserOn: true }))
          .toEqual({ computer: pin, browser: false, pinned: pin, clearPin: false, note: "" });
      }
    }
  });

  it("a browser pin that cannot be honoured falls back to the default and asks to be cleared", () => {
    expect(resolveSurface({ destination: "cloud", pinnedSurface: "browser", browserOn: false }))
      .toEqual({ computer: "cloud", browser: false, pinned: null, clearPin: true, note: "" });
    expect(resolveSurface({ destination: undefined, pinnedSurface: "browser", browserOn: false }))
      .toEqual({ computer: undefined, browser: false, pinned: null, clearPin: true, note: "" });
    // a browser-only bot with no browser keeps its explanation
    expect(resolveSurface({ destination: "browser", pinnedSurface: "browser", browserOn: false }))
      .toMatchObject({ computer: "off", browser: false, clearPin: true, note: expect.stringMatching(/switched off/) });
  });

  it("Auto without a pin leaves the computer to the dispatch and keeps the browser as its fallback", () => {
    expect(resolveSurface({ destination: undefined, browserOn: true })).toEqual({
      computer: undefined,
      browser: true,
      pinned: null,
      clearPin: false,
      note: "",
    });
    expect(resolveSurface({ destination: undefined, browserOn: false })).toMatchObject({ computer: undefined, browser: false });
  });
});

describe("surfacePrompt", () => {
  it("names both surfaces and splits the work when both are mounted", () => {
    const text = surfacePrompt({ computer: "cloud", browser: true });
    expect(text).toMatch(/Two surfaces are mounted/);
    expect(text).toMatch(/Web tasks → the built-in browser/);
    expect(text).toMatch(/Desktop apps, files and shell → the cloud computer tools/);
    expect(text).toMatch(/Pick one surface for a task and stay on it/);
    expect(text).toMatch(/say which surface — the Browser tab or the cloud computer/);
  });

  it("names only the computer when it is the only surface", () => {
    const text = surfacePrompt({ computer: "vm", browser: false });
    expect(text).toMatch(/happens on the Local VM, web pages included/);
    expect(text).toMatch(/no separate built-in browser/);
    expect(text).toMatch(/say in one short sentence where you are working/);
    expect(text).not.toMatch(/Two surfaces/);
    expect(surfacePrompt({ computer: "local", browser: false })).toMatch(/tell them it is on this computer/);
  });

  it("names only the browser tab when it is the only surface", () => {
    const text = surfacePrompt({ computer: null, browser: true });
    expect(text).toMatch(/happens in the built-in browser tab/);
    expect(text).toMatch(/no desktop, file or shell computer/);
    expect(text).toMatch(/Browser tab of the Computer panel/);
    expect(text).toMatch(/say in one short sentence where you are working/);
    expect(text).not.toMatch(/cloud computer/);
  });

  it("is silent with nothing mounted, and carries the pin line and the note", () => {
    expect(surfacePrompt({ computer: null, browser: false })).toBe("");
    expect(surfacePrompt({ computer: "cloud", browser: false }, { pinned: "cloud" }))
      .toMatch(/This task has been running on the cloud computer; keep using it unless the user says otherwise\./);
    expect(surfacePrompt({ computer: null, browser: false }, { note: " NOTE." })).toBe(" NOTE.");
  });
});

describe("surfaceForTool", () => {
  it("trusts the Claude driver's server namespace", () => {
    expect(surfaceForTool("mcp__browser__browser_snapshot", { computer: "cloud", browser: true })).toBe("browser");
    expect(surfaceForTool("mcp__computer__browser_snapshot", { computer: "cloud", browser: true })).toBe("cloud");
    expect(surfaceForTool("mcp__computer__screenshot", { computer: "local", browser: false })).toBe("local");
    // a namespaced call for something this turn never mounted is noise
    expect(surfaceForTool("mcp__browser__browser_click", { computer: "cloud", browser: false })).toBeNull();
  });

  it("only trusts a bare name when one surface was mounted", () => {
    expect(surfaceForTool("browser_snapshot", { computer: "cloud", browser: true })).toBeNull();
    expect(surfaceForTool("screenshot", { computer: "vm", browser: false })).toBe("vm");
    expect(surfaceForTool("browser_navigate", { computer: null, browser: true })).toBe("browser");
    expect(surfaceForTool("Bash: ls", { computer: "vm", browser: false })).toBeNull();
    expect(surfaceForTool("Read", { computer: null, browser: true })).toBeNull();
  });
});

describe("surface parsing", () => {
  it("accepts only the four surfaces off the wire", () => {
    expect(parseSurface("browser")).toBe("browser");
    expect(parseSurface("cloud")).toBe("cloud");
    expect(parseSurface("box")).toBeUndefined();
    expect(parseSurface(42)).toBeUndefined();
    expect(parseSurface(undefined)).toBeUndefined();
  });

  it("folds both cloud backends into one surface", () => {
    expect(surfaceOfComputerKind("box")).toBe("cloud");
    expect(surfaceOfComputerKind("vps")).toBe("cloud");
    expect(surfaceOfComputerKind("vm")).toBe("vm");
    expect(surfaceOfComputerKind("local")).toBe("local");
    expect(surfaceOfComputerKind(null)).toBeNull();
  });
});
