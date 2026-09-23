import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Bot } from "@/state/store";
import { formFromVisibility, visibilityFromForm, VisibilitySection } from "./VisibilitySection";

const bot = (visibility?: Bot["visibility"]) => ({ id: "b1", name: "Payroll", visibility } as unknown as Bot);

describe("bot visibility form", () => {
  it("round-trips the three settings", () => {
    expect(formFromVisibility(undefined)).toEqual({ mode: "everyone", people: "" });
    expect(formFromVisibility("everyone")).toEqual({ mode: "everyone", people: "" });
    expect(formFromVisibility("admins")).toEqual({ mode: "admins", people: "" });
    expect(formFromVisibility({ people: ["ada@example.test", "@acme.test"] })).toEqual({ mode: "people", people: "ada@example.test\n@acme.test" });
    expect(visibilityFromForm("everyone", "ignored")).toEqual({ ok: true, visibility: "everyone" });
    expect(visibilityFromForm("admins", "")).toEqual({ ok: true, visibility: "admins" });
    expect(visibilityFromForm("people", " Ada@Example.test,\n@acme.test ; ada@example.test ")).toEqual({ ok: true, visibility: { people: ["ada@example.test", "@acme.test"] } });
    // an empty list is refused here rather than saved as "admins only" by surprise
    expect(visibilityFromForm("people", " \n ")).toEqual({ ok: false });
  });

  it("renders the stored choice, with the list when it names people", () => {
    const people = renderToStaticMarkup(createElement(VisibilitySection, { bot: bot({ people: ["ada@example.test"] }) }));
    expect(people).toContain("Only these people");
    expect(people).toMatch(/checked="" value="people"/);
    expect(people).toContain("ada@example.test</textarea>");
    const everyone = renderToStaticMarkup(createElement(VisibilitySection, { bot: bot() }));
    expect(everyone).toMatch(/checked="" value="everyone"/);
    expect(everyone).not.toContain("<textarea");
  });
});
