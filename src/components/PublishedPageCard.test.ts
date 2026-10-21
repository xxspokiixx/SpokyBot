// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

const dispatch = vi.fn();
const api = vi.fn(async (_path: string, _init?: RequestInit) => ({ ok: true }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: {}, dispatch }), api: (path: string, init?: RequestInit) => api(path, init) }));
const openExternalLink = vi.fn(async (_url: string) => {});
vi.mock("@/lib/app-links", () => ({ openExternalLink: (url: string) => openExternalLink(url) }));
import { PublishedPageCard } from "./PublishedPageCard";

const URL = "https://abcdefghijklmnopqrstuvwxyz.mausbot.page/";
const page = (card: Message["publishedPage"]): Message => ({ id: "m1", at: 1, role: "bot", kind: "text", text: "fallback", publishedPage: card });

function render(message: Message) {
  const container = document.createElement("div"), root = createRoot(container);
  flushSync(() => root.render(createElement(PublishedPageCard, { message })));
  return { container, root };
}

afterEach(() => { vi.clearAllMocks(); delete (window as { ogb?: unknown }).ogb; });

describe("a published page's card", () => {
  it("shows the title, the link and the usage, opens the link and unpublishes the page", async () => {
    const { container, root } = render(page({ state: "live", title: "Bake sale", pageId: "abcdefghijklmnopqrstuvwxyz", url: URL, usage: { pages: 3, limit: 5 } }));
    try {
      expect(container.textContent).toContain("Bake sale");
      expect(container.textContent).toContain(URL);
      expect(container.textContent).toContain("3 of 5 pages");
      const buttons = [...container.querySelectorAll("button")];
      expect(buttons.map((button) => button.textContent)).toEqual(["Copy link", "Open", "Unpublish"]);
      buttons[1]!.click();
      expect(openExternalLink).toHaveBeenCalledWith(URL);
      buttons[2]!.click();
      await vi.waitFor(() => expect(api).toHaveBeenCalledWith("/api/published-pages/abcdefghijklmnopqrstuvwxyz/unpublish", { method: "POST", body: "{}" }));
    } finally { root.unmount(); }
  });

  it("says when the page was unpublished, with no buttons", () => {
    const { container, root } = render(page({ state: "unpublished", title: "Bake sale", pageId: "abcdefghijklmnopqrstuvwxyz", url: URL, usage: { pages: 2, limit: 5 } }));
    try {
      expect(container.textContent).toContain("Unpublished. The link no longer opens.");
      expect(container.textContent).toContain("2 of 5 pages");
      expect(container.querySelectorAll("button")).toHaveLength(0);
    } finally { root.unmount(); }
  });

  it("at the free limit, says so in the person's words and opens the app's Get Cloud flow", () => {
    (window as { ogb?: unknown }).ogb = { cloudAccount: {} };
    const { container, root } = render(page({ state: "limit", title: "Bake sale", plan: "free", upgrade: true, usage: { pages: 5, limit: 5 }, message: "server words" }));
    try {
      expect(container.textContent).toContain("You’ve used your 5 free pages. MausBot Cloud gives you more, and pages without the badge.");
      expect(container.textContent).toContain("5 of 5 pages");
      container.querySelector("button")!.click();
      expect(dispatch).toHaveBeenCalledWith({ type: "openCloudAdd", source: "app_pages" });
    } finally { root.unmount(); }
  });

  it("names the plan at a paid plan's limit, and offers no button without the desktop app's Cloud sign-in", () => {
    const { container, root } = render(page({ state: "limit", title: "Bake sale", plan: "personal", upgrade: true, usage: { pages: 25, limit: 25 } }));
    try {
      expect(container.textContent).toContain("You’ve used all 25 pages on your Personal plan. Unpublish a page to make room.");
      expect(container.querySelectorAll("button")).toHaveLength(0);
    } finally { root.unmount(); }
  });
});
