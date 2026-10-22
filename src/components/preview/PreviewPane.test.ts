// @vitest-environment happy-dom
// happy-dom runs no script in the frame, so the page is played by message events from the frame's window.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Bot, type Message, type useStore } from "@/state/store";
import { forgetPreviewState, openPreview } from "@/lib/preview-pane";
import type { AppPayload } from "../../../shared/app";
import { botHtmlDocument } from "../../../shared/app-frame/document";
import { RichMessageRow } from "../RichMessageRow";
import { PreviewPaneHost } from "./PreviewPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const payload = (more: Partial<AppPayload> = {}): AppPayload => ({
  v: 1, source: "html", title: "Pricing", doc: "d0", rev: 0, bytes: 900, border: true, network: { connect: [], resources: [] }, ...more,
});
const page = (app: AppPayload, id = "a1", at = 10): Message => ({ id, role: "bot", kind: "app", at, text: "[App] Pricing", app });
const said = (id: string, at: number): Message => ({ id, role: "user", kind: "text", at, text: "Make a pricing page" });
const bot = (messages: Message[]): Bot => ({ id: "pepper", threadId: "t1", name: "Pepper", messages } as unknown as Bot);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const dispatch = vi.fn();
const store = { state: {}, dispatch, flushBotPatches: vi.fn(async () => null) } as unknown as ReturnType<typeof useStore>;
let published: { pageId: string; url: string } | null = null;

let host: HTMLDivElement;
let root: Root;

const view = (current: Bot) => createElement(BotEditorStore, {
  value: store,
  children: [
    createElement(PreviewPaneHost, { key: "pane", bot: current }),
    ...current.messages.map((message) => createElement(RichMessageRow, { key: message.id, botId: current.id, botName: current.name, threadId: current.threadId, message })),
  ],
});
const render = async (current: Bot) => {
  await act(async () => { root.render(view(current)); });
  await settle();
};
const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
const pane = () => host.querySelector<HTMLElement>("[data-preview-pane]");
const frame = () => host.querySelector<HTMLIFrameElement>("[data-preview-pane] iframe")!;
const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
  .find((element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label)!;
const click = (label: string) => act(async () => { button(label).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
const fetched = () => fetchMock.mock.calls.map(([path]) => path).filter((path) => path.includes("/app") && !path.endsWith("/publish"));

beforeEach(() => {
  published = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (path, init) => {
    const url = new URL(path, "http://omb.test");
    if (url.pathname.endsWith("/app/publish")) {
      if (init?.method !== "POST") return json(200, { published });
      published = { pageId: "page000000000000000000001", url: "https://page000000000000000000001.mausbot.page/" };
      return json(200, { ok: true, card: { state: "live", title: "Pricing", ...published, usage: { pages: 1, limit: 5 } } });
    }
    const rev = Number(url.searchParams.get("rev") ?? "-1");
    return json(200, botHtmlDocument({ messageId: "a1", rev: rev < 0 ? 0 : rev, html: `<p>version ${rev < 0 ? "latest" : rev + 1}</p>` }));
  });
  vi.stubGlobal("fetch", fetchMock);
  forgetPreviewState();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the preview pane", () => {
  it("opens by itself on a page that arrives, not on the pages already there, and draws pages as cards", async () => {
    await render(bot([said("u1", 1), page(payload(), "old", 2)]));
    expect(pane()).toBeNull();
    expect(host.querySelector("[data-page-card=old]")?.textContent).toContain("Page made by Pepper · v1");
    expect(host.querySelector("[data-page-card=old] iframe")).toBeNull();
    await render(bot([said("u1", 1), page(payload(), "old", 2), said("u2", 3), page(payload({ doc: "d9" }), "a1", 4)]));
    expect(pane()?.getAttribute("data-preview-pane")).toBe("a1");
    expect(frame().getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(frame().style.height).toBe("100%");
    expect(button("Showing").getAttribute("aria-pressed")).toBe("true");
    await click("Close preview");
    expect(pane()).toBeNull();
    await click("Open");
    expect(pane()).not.toBeNull();
  });

  it("refreshes in place on update_html, flashes Updated, and steps back to the versions it keeps", async () => {
    await render(bot([page(payload())]));
    act(() => openPreview({ botId: "pepper", threadId: "t1", messageId: "a1" }));
    await settle();
    expect(host.querySelector("[data-preview-version]")?.textContent).toBe("v1");
    expect(host.querySelector("[data-preview-updated]")).toBeNull();
    await render(bot([page(payload({ doc: "d1", rev: 1, history: ["d0"] }))]));
    expect(host.querySelector("[data-preview-version]")?.textContent).toBe("v2");
    expect(host.querySelector("[data-preview-updated]")?.textContent).toBe("Updated");
    expect(fetched()).toEqual(["/api/threads/t1/messages/a1/app", "/api/threads/t1/messages/a1/app"]);
    await click("Earlier version");
    await settle();
    expect(host.querySelector("[data-preview-version]")?.textContent).toBe("v1 of 2");
    expect(fetched().at(-1)).toBe("/api/threads/t1/messages/a1/app?rev=0");
    expect(frame().srcdoc).toContain("<p>version 1</p>");
    expect(button("Earlier version").disabled).toBe(true);
    await click("Back to the latest");
    await settle();
    expect(host.querySelector("[data-preview-version]")?.textContent).toBe("v2");
  });

  it("publishes the version on screen, then shows the link with Copy, and remembers it next time", async () => {
    await render(bot([page(payload())]));
    act(() => openPreview({ botId: "pepper", threadId: "t1", messageId: "a1" }));
    await settle();
    expect(host.querySelector("[data-preview-published]")).toBeNull();
    await click("Publish");
    await settle();
    const sent = fetchMock.mock.calls.find(([path, init]) => path.endsWith("/app/publish") && init?.method === "POST")!;
    expect(JSON.parse(String(sent[1]!.body))).toEqual({ rev: 0 });
    expect(host.querySelector("[data-preview-published]")?.textContent).toContain("https://page000000000000000000001.mausbot.page/");
    expect(button("Copy link")).toBeDefined();
    expect(button("Update link")).toBeDefined();
    await click("Close preview");
    await click("Open");
    await settle();
    expect(host.querySelector("[data-preview-published]")?.textContent).toContain("Published");
  });
});
