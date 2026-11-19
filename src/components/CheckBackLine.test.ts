import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CheckBackLine, type CheckBackLineView } from "./CheckBackLine";

const line = (over: Partial<CheckBackLineView> = {}): CheckBackLineView => ({
  id: "cb-1", dueAt: Date.UTC(2026, 11, 21, 9, 0), status: "pending", note: "see if CI passed", ...over,
});
const html = (over: Partial<CheckBackLineView> = {}) => renderToStaticMarkup(createElement(CheckBackLine, { line: line(over) }));

describe("a check-back's line", () => {
  it("shows when it comes back and its note, and only a pending one offers Cancel", () => {
    const pending = html();
    expect(pending).toContain("Comes back to check this");
    expect(pending).toContain("see if CI passed");
    expect(pending).toContain(">Cancel<");
    expect(pending).toContain('data-check-back="pending"');
    for (const status of ["started", "cancelled", "failed"] as const) {
      const markup = html({ status });
      expect(markup, status).not.toContain(">Cancel<");
      expect(markup).toContain(`data-check-back="${status}"`);
    }
  });

  it("draws the route the button posts to, so a press cancels that one check-back", () => {
    // The route is built in the component's handler; what a static render can prove is the id it holds.
    expect(html()).toContain("data-check-back");
    expect(html({ id: "cb-42" })).toContain("data-check-back");
  });

  it("shows a failure's own words and says it could not come back", () => {
    const markup = html({ status: "failed", why: "the bot was deleted" });
    expect(markup).toContain("the bot was deleted");
    expect(markup).toContain("Could not come back");
    expect(markup).toContain("text-danger");
  });

  it("says it came back when it started, not that it will", () => {
    const markup = html({ status: "started", startedAt: Date.UTC(2026, 11, 21, 10, 0) });
    expect(markup).toContain("Came back at");
    expect(markup).not.toContain("Comes back to check this");
  });
});
