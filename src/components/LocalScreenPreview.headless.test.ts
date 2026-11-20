// The phone's Screen panel shows the proot desktop itself, so the local preview card would only
// offer a capture the WebView cannot perform.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ value: "android" as string }));
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({
    ready: true,
    capabilities: {
      host: { platform: platform.value, label: "Android", session: "headless", packaged: true },
      windowChrome: "native",
      screenPreview: { available: false, interaction: "none", reasonCode: "headless-environment" },
      dictation: { available: false, engine: "none", onDevice: false },
      localComputer: { available: true, support: "supported", enabled: true, status: "ready" },
    },
  }),
}));

const { LocalScreenPreview } = await import("./LocalScreenPreview");

describe("local screen preview on a headless host", () => {
  it("stays hidden where no display can be captured", () => {
    expect(renderToStaticMarkup(createElement(LocalScreenPreview))).toBe("");
    platform.value = "linux";
    expect(renderToStaticMarkup(createElement(LocalScreenPreview))).toContain("Preview this computer");
  });
});
