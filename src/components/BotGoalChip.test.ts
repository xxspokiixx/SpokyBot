import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ThreadGoal } from "../../shared/bot-goal";
import { goalCommandEffect } from "@/lib/bot-goal";
import { BotGoalChip, goalChipLabel } from "./BotGoalChip";

const goal = (patch: Partial<ThreadGoal> = {}): ThreadGoal => ({
  text: "get all tests passing", status: "active", turns: 3, maxTurns: 10, startedAt: 1, updatedAt: 1, ...patch,
});
const render = (g: ThreadGoal) => renderToStaticMarkup(createElement(BotGoalChip, { goal: g, onAct: () => undefined }));

describe("BotGoalChip", () => {
  it("shows the goal and which turn it is on, with Pause and Clear", () => {
    const html = render(goal());
    expect(html).toContain("Goal, turn 3 of 10");
    expect(html).toContain("get all tests passing");
    expect(html).toContain(">Pause<");
    expect(html).toContain(">Clear<");
    expect(html).not.toContain(">Resume<");
  });

  it("says why a goal is paused and offers Resume", () => {
    const html = render(goal({ status: "paused", reason: "stopped" }));
    expect(html).toContain("Goal paused: you pressed Stop");
    expect(html).toContain(">Resume<");
    expect(html).not.toContain(">Pause<");
  });

  it("marks a finished goal and only offers Clear", () => {
    const html = render(goal({ status: "complete" }));
    expect(goalChipLabel(goal({ status: "complete" }))).toBe("Goal complete");
    expect(html).toContain(">Clear<");
    expect(html).not.toContain(">Pause<");
    expect(html).not.toContain(">Resume<");
  });
});

describe("goalCommandEffect", () => {
  it("turns a typed command into a request or a notice", () => {
    expect(goalCommandEffect({ kind: "set", text: "ship" }, undefined)).toEqual({ request: { action: "set", text: "ship" } });
    expect(goalCommandEffect({ kind: "pause" }, goal())).toEqual({ request: { action: "pause" } });
    expect(goalCommandEffect({ kind: "show" }, goal())).toEqual({ notice: "Goal: get all tests passing" });
    expect(goalCommandEffect({ kind: "show" }, undefined)).toMatchObject({ notice: expect.stringContaining("No goal is set") });
  });
});
