import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FADED_PROVIDER_MARK, providerMarkTone } from "./provider-mark-fade";
import { InstanceProviderMark, ProviderMark } from "./ProviderIcons";

const DRIVERS = [
  "grok", "grokAgent", "claudeAgent", "mistral", "meta", "museCode", "codex", "kimiAgent", "droidAgent", "cursorAgent",
  "antigravityAgent", "opencodeGo", "qwenAgent", "hermesAgent", "deepseekAgent", "piAgent", "anEngineWithNoMark",
];

describe("the faded provider mark", () => {
  it.each(DRIVERS)("treats %s as a brand-coloured mark exactly when its logo carries its own colours", (driverKind) => {
    const html = renderToStaticMarkup(createElement(ProviderMark, { driverKind, size: 14 }));
    const coloured = /#[0-9a-f]{3,8}\b|url\(#/i.test(html);
    expect(providerMarkTone({ driverKind })).toBe(coloured ? "brand" : "mono");
  });

  it("treats an engine's own picture and a preset logo as brand-coloured", () => {
    expect(providerMarkTone({ driverKind: "codex", icon: { kind: "preset", preset: "openrouter" } })).toBe("brand");
    expect(providerMarkTone({ driverKind: "codex", icon: { kind: "custom", dataUrl: "data:image/png;base64,AA==" } })).toBe("brand");
  });

  it("dims a brand mark to 60% and inks a monochrome one in tertiary, both full again on hover", () => {
    const claude = renderToStaticMarkup(createElement(InstanceProviderMark, { instance: { driverKind: "claudeAgent" }, size: 14, subtle: true }));
    expect(claude).toMatch(/^<span data-provider-mark="brand" class="[^"]*\bopacity-60\b[^"]*\bgroup-hover:opacity-100\b/);
    expect(claude).toContain('style="width:14px;height:14px"');
    const codex = renderToStaticMarkup(createElement(InstanceProviderMark, { instance: { driverKind: "codex" }, size: 14, subtle: true }));
    expect(codex).toContain('data-provider-mark="mono"');
    expect(codex).toContain("[--color-ink:var(--color-ink-tertiary)]");
    expect(codex).toContain("group-hover:[--color-ink:inherit]");
    expect(codex).not.toContain("opacity-60");
    expect(FADED_PROVIDER_MARK.mono).not.toContain("opacity");
  });

  it("leaves the full-strength mark alone without subtle", () => {
    const html = renderToStaticMarkup(createElement(InstanceProviderMark, { instance: { driverKind: "claudeAgent" }, size: 14 }));
    expect(html).toMatch(/^<svg/);
    expect(html).not.toContain("data-provider-mark");
  });
});
