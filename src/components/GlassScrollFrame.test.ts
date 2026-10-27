import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GlassBar, publishGlassInsets } from "./GlassScrollFrame";

function child(glassBar: string | undefined, height: number) {
  return { dataset: glassBar === undefined ? {} : { glassBar }, getBoundingClientRect: () => ({ height }) };
}

function frame(children: ReturnType<typeof child>[]) {
  const vars = new Map<string, string>();
  const element = { children, style: { setProperty: (name: string, value: string) => vars.set(name, value) } };
  publishGlassInsets(element as unknown as HTMLElement);
  return vars;
}

describe("publishGlassInsets", () => {
  it("publishes each bar's height, rounded up so no row ever tucks under a sub-pixel edge", () => {
    const vars = frame([child("top", 120.4), child(undefined, 900), child("bottom", 186)]);
    expect(vars.get("--glass-top")).toBe("121px");
    expect(vars.get("--glass-bottom")).toBe("186px");
  });

  it("publishes 0px for an edge without a bar, so a header-only frame keeps no bottom gap", () => {
    const vars = frame([child("top", 64), child(undefined, 500)]);
    expect(vars.get("--glass-top")).toBe("64px");
    expect(vars.get("--glass-bottom")).toBe("0px");
  });

  it("ignores everything that is not a bar, the scroller included", () => {
    const vars = frame([child(undefined, 700), child("sideways", 40)]);
    expect(vars.get("--glass-top")).toBe("0px");
    expect(vars.get("--glass-bottom")).toBe("0px");
  });
});

describe("a fading bar", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[[\]().:"]/g, "\\$&")} \\{[^}]*\\}`))?.[0] ?? "";

  it("marks itself, and a plain bar stays glass", () => {
    const fading = renderToStaticMarkup(createElement(GlassBar, { edge: "top", fade: true, children: "x" }));
    const glass = renderToStaticMarkup(createElement(GlassBar, { edge: "top", children: "x" }));
    expect(fading).toContain('data-glass-fade=""');
    expect(glass).not.toContain("data-glass-fade");
  });

  it("fades into the canvas with no tint or blur: hidden at the edge, full strength over its last 60px", () => {
    const fade = rule('.glass-bar[data-glass-fade]::before');
    expect(fade).toContain("linear-gradient(to bottom, var(--color-app), var(--color-app) calc(100% - var(--glass-fade)), transparent)");
    expect(fade).toMatch(/[^-]backdrop-filter: none/);
    expect(fade).toContain("mask-image: none");
    expect(rule('.glass-bar[data-glass-fade]')).toContain("--glass-fade: 60px");
  });
});
