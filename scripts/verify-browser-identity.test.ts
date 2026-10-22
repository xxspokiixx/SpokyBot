import { describe, expect, it, vi } from "vitest";

import { expectedUserAgent } from "./testing/browser-identity-probe.ts";
import { completeHints, headerLanguages, openIdentityProbe, type BotCall } from "./verify-browser-identity.ts";

const MAC = {
  architecture: "arm", bitness: "64", brands: [{ brand: "Chromium", version: "153" }], formFactors: ["Desktop"],
  fullVersionList: [{ brand: "Chromium", version: "153.0.8010.47" }], mobile: false, model: "", platform: "macOS",
  platformVersion: "26.3.1", uaFullVersion: "153.0.8010.47", wow64: false,
};

describe("the identity checks", () => {
  it("want every high-entropy hint, where Chrome reports it", () => {
    expect(completeHints(MAC)).toBe(true);
    expect(completeHints({ ...MAC, platformVersion: "" })).toBe(false);
    expect(completeHints({ ...MAC, platform: "Linux", platformVersion: "" })).toBe(true);
    expect(completeHints({ ...MAC, architecture: "", fullVersionList: [] })).toBe(false);
    expect(completeHints(null)).toBe(false);
  });

  it("expect Chrome's reduced user agent for each desktop", () => {
    expect(expectedUserAgent("153", "darwin")).toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36");
    expect(expectedUserAgent("155", "win32")).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36");
    expect(expectedUserAgent("155", "linux")).toBe("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36");
  });

  it("compare navigator.languages with the header's languages, without q-values", () => {
    expect(headerLanguages("en-US,en;q=0.9")).toBe("en-US,en");
    expect(headerLanguages("pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("pt-BR,pt,en-US,en");
    expect(headerLanguages(undefined)).toBe("");
  });
});

describe("opening the owned identity probe", () => {
  const url = "http://127.0.0.1:43127/probe";
  const opened = { content: [{ type: "text", text: "Opened probe" }] };
  const aborted = { isError: true, content: [{ type: "text", text: "Navigation failed: net::ERR_ABORTED" }] };

  it("keeps a successful open to one navigation", async () => {
    const call = vi.fn<BotCall>().mockResolvedValue(opened);
    await openIdentityProbe(call, url);
    expect(call).toHaveBeenCalledExactlyOnceWith("agent_browser_open", { url });
  });

  it("retries an aborted navigation of the owned probe once", async () => {
    const call = vi.fn<BotCall>().mockResolvedValueOnce(aborted).mockResolvedValue(opened);
    await openIdentityProbe(call, url);
    expect(call.mock.calls).toEqual([
      ["agent_browser_open", { url }],
      ["agent_browser_open", { url }],
    ]);
  });

  it("fails when the second navigation is aborted too", async () => {
    const call = vi.fn<BotCall>().mockResolvedValue(aborted);
    await expect(openIdentityProbe(call, url)).rejects.toThrow("Navigation failed: net::ERR_ABORTED");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("preserves other navigation failures without retrying", async () => {
    const call = vi.fn<BotCall>().mockResolvedValue({ isError: true,
      content: [{ type: "text", text: "Navigation failed: net::ERR_CONNECTION_REFUSED" }] });
    await expect(openIdentityProbe(call, url)).rejects.toThrow("Navigation failed: net::ERR_CONNECTION_REFUSED");
    expect(call).toHaveBeenCalledOnce();
  });

  it("preserves a lost engine response without retrying", async () => {
    const call = vi.fn<BotCall>().mockRejectedValue(new Error("engine disconnected"));
    await expect(openIdentityProbe(call, url)).rejects.toThrow("engine disconnected");
    expect(call).toHaveBeenCalledOnce();
  });
});
