import { afterEach, describe, expect, it, vi } from "vitest";

import { showBrowserUnread, titleWithUnread } from "./bot-unread";

describe("browser unread indicator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefixes the title with the count, and drops it at zero", () => {
    expect(titleWithUnread("OpenMausBot", 3)).toBe("(3) OpenMausBot");
    expect(titleWithUnread("Acme", 0)).toBe("Acme");
  });

  it("sets the title and the app badge, and clears both", () => {
    const doc = { title: "" };
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });

    showBrowserUnread(2, "OpenMausBot");
    expect(doc.title).toBe("(2) OpenMausBot");
    expect(setAppBadge).toHaveBeenCalledWith(2);

    showBrowserUnread(0, "OpenMausBot");
    expect(doc.title).toBe("OpenMausBot");
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("still sets the title where the Badging API is missing or refuses", () => {
    const doc = { title: "" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", {});
    showBrowserUnread(1, "OpenMausBot");
    expect(doc.title).toBe("(1) OpenMausBot");

    vi.stubGlobal("navigator", { setAppBadge: () => Promise.reject(new Error("NotAllowedError")) });
    showBrowserUnread(4, "OpenMausBot");
    expect(doc.title).toBe("(4) OpenMausBot");
  });
});
