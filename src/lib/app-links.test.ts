// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openExternalLink } from "./app-links";

afterEach(() => {
  Reflect.deleteProperty(window, "ombAndroidCaps");
  Reflect.deleteProperty(window, "ogb");
  vi.restoreAllMocks();
});

describe("openExternalLink", () => {
  it("uses the Electron opener when the packaged app provides one", async () => {
    const openExternal = vi.fn(async () => {});
    Object.defineProperty(window, "ogb", { value: { openExternal }, configurable: true });
    try {
      await openExternalLink("https://example.test/docs");
      expect(openExternal).toHaveBeenCalledWith("https://example.test/docs");
    } finally {
      Reflect.deleteProperty(window, "ogb");
    }
  });

  it("hands http links to the phone shell's system browser, never a blocked popup", async () => {
    const openExternal = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    Object.defineProperty(window, "ombAndroidCaps", { value: { capabilitiesJson: () => "{}", openExternal }, configurable: true });
    await openExternalLink("https://example.test/docs");
    expect(openExternal).toHaveBeenCalledWith("https://example.test/docs");
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps the popup flow for non-http links on the phone shell", async () => {
    const openExternal = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    Object.defineProperty(window, "ombAndroidCaps", { value: { capabilitiesJson: () => "{}", openExternal }, configurable: true });
    await openExternalLink("mailto:team@example.test");
    expect(openExternal).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("mailto:team@example.test", "_blank", "noopener,noreferrer");
  });
});
