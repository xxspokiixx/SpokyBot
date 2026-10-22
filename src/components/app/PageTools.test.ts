// @vitest-environment happy-dom
// A bot's page inline in the chat, with its tools. happy-dom runs no script in the frame, so the page is played by
// message events from the frame's window.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { addPointedChip, forgetPointedChips, takePointedChips, usePointedChips } from "@/lib/pointed-chips";
import type { AppPayload } from "../../../shared/app";
import { botHtmlDocument } from "../../../shared/app-frame/document";
import { POINT_LIMITS, POINTED_METHOD } from "../../../shared/app-frame/point";
import { createAppPool, type AppPool } from "./app-pool";
import { AppMessage, forgetAppRows } from "./AppMessage";
import { PAGE_HEIGHT } from "./PageTools";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const payload = (more: Partial<AppPayload> = {}): AppPayload => ({
  v: 1, source: "html", title: "Pricing", doc: "d0", rev: 0, bytes: 900, border: true, network: { connect: [], resources: [] }, ...more,
});
const row = (app: AppPayload): Message => ({ id: "a1", role: "bot", kind: "app", at: 1, text: "[App] Pricing", app });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const openExternal = vi.fn(async () => true);
const store = { state: {}, dispatch: vi.fn(), flushBotPatches: vi.fn(async () => null) } as unknown as ReturnType<typeof useStore>;
const LINK = "https://page000000000000000000001.mausbot.page/";
let published: { pageId: string; url: string } | null = null;

let host: HTMLDivElement;
let root: Root;
let pool: AppPool;

function Chips() {
  const chips = usePointedChips("t1");
  return createElement("output", { "data-chips": JSON.stringify(chips.map(({ id: _id, ...chip }) => chip)) });
}
const render = async (message: Message) => {
  await act(async () => {
    root.render(createElement(BotEditorStore, { value: store, children: [
      createElement(AppMessage, { key: "row", botId: "pepper", botName: "Pepper", threadId: "t1", message, pool }),
      createElement(Chips, { key: "chips" }),
    ] }));
  });
  await settle();
};
const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
const card = () => host.querySelector<HTMLElement>("[data-app=a1]")!;
const overlay = () => document.querySelector<HTMLElement>("[data-page-fullscreen]");
const inlineFrame = () => card().querySelector<HTMLIFrameElement>("iframe")!;
const wideFrame = () => overlay()!.querySelector<HTMLIFrameElement>("iframe")!;
const button = (label: string, within: ParentNode = document) => Array.from(within.querySelectorAll<HTMLButtonElement>("button"))
  .find((element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label)!;
const click = (label: string, within?: ParentNode) => act(async () => { button(label, within).click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
const chips = () => JSON.parse(host.querySelector("[data-chips]")!.getAttribute("data-chips")!) as unknown[];
const documents = () => fetchMock.mock.calls.map(([path]) => path).filter((path) => path.includes("/app") && !path.includes("/publish"));
const fromFrame = (data: unknown, source: unknown) => act(async () => {
  window.dispatchEvent(new MessageEvent("message", { data, source: source as MessageEventSource }));
  await new Promise((resolve) => setTimeout(resolve, 0));
});
const PICK = { jsonrpc: "2.0", method: POINTED_METHOD, params: { tag: "button", role: "button", text: "Choose Pro", selector: "main > section:nth-of-type(2) > button", html: "<button>Choose Pro</button>" } };

beforeEach(() => {
  published = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (path, init) => {
    const url = new URL(path, "http://omb.test");
    if (url.pathname.endsWith("/app/publish")) {
      if (init?.method !== "POST") return json(200, { published });
      published = { pageId: "page000000000000000000001", url: LINK };
      return json(200, { ok: true, card: { state: "live", title: "Pricing", ...published, usage: { pages: 1, limit: 5 } } });
    }
    const rev = url.searchParams.get("rev");
    return json(200, botHtmlDocument({ messageId: "a1", rev: rev === null ? 0 : Number(rev), html: `<p>${rev === null ? "newest" : `version ${Number(rev) + 1}`}</p>` }));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("ogb", { openExternal });
  vi.stubGlobal("IntersectionObserver", undefined);
  pool = createAppPool({ limit: 3 });
  forgetAppRows();
  forgetPointedChips();
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

describe("a bot's page in the chat", () => {
  it("draws inline at the page height, with its version, Point, Share, Open in new tab and Full screen", async () => {
    await render(row(payload()));
    expect(card().querySelector("[data-page-version]")?.textContent).toBe("v1");
    expect(inlineFrame().getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(card().querySelector<HTMLElement>("[data-app-box]")!.style.height).toBe(`${PAGE_HEIGHT.start}px`);
    for (const label of ["Point", "Share", "Full screen"]) expect(button(label, card()).disabled, label).toBe(false);
    expect(button("Open in new tab", card()).disabled).toBe(true);
    expect(button("Open in new tab", card()).title).toBe("Share the page to open it in a new tab");
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/app/publish"))).toBe(true);
  });

  it("refreshes the same card on update_html with Updated, and steps back to the versions it keeps", async () => {
    await render(row(payload()));
    await render(row(payload({ doc: "d1", rev: 1, history: ["d0"] })));
    expect(host.querySelectorAll("[data-app]")).toHaveLength(1);
    expect(card().querySelector("[data-page-version]")?.textContent).toBe("v2");
    expect(card().querySelector("[data-page-updated]")?.textContent).toBe("Updated");
    await click("Earlier version", card());
    expect(card().querySelector("[data-page-version]")?.textContent).toBe("v1 of 2");
    expect(documents().at(-1)).toBe("/api/threads/t1/messages/a1/app?rev=0");
    expect(inlineFrame().srcdoc).toContain("<p>version 1</p>");
    expect(button("Earlier version", card()).disabled).toBe(true);
    await click("Back to the latest", card());
    expect(card().querySelector("[data-page-version]")?.textContent).toBe("v2");
    expect(inlineFrame().srcdoc).toContain("<p>newest</p>");
  });

  it("points inline: only the page's own frame, only while Point is on, and the pick becomes a chip for the version on screen", async () => {
    await render(row(payload()));
    const posted = vi.spyOn(inlineFrame().contentWindow!, "postMessage").mockImplementation(() => {});
    await fromFrame(PICK, inlineFrame().contentWindow);
    expect(chips()).toEqual([]);
    await click("Point", card());
    expect(posted).toHaveBeenLastCalledWith({ jsonrpc: "2.0", method: "mausbot/point", params: { on: true } }, "*");
    expect(card().textContent).toContain("Click the part of the page you want changed.");
    await fromFrame(PICK, window);
    expect(chips()).toEqual([]);
    await fromFrame(PICK, inlineFrame().contentWindow);
    expect(chips()).toEqual([{ appId: "a1", rev: 0, title: "Pricing", tag: "button", role: "button", text: "Choose Pro",
      selector: "main > section:nth-of-type(2) > button", html: "<button>Choose Pro</button>" }]);
    expect(button("Point", card()).getAttribute("aria-pressed")).toBe("false");
    await click("Point", card());
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(button("Point", card()).getAttribute("aria-pressed")).toBe("false");
    expect(posted).toHaveBeenLastCalledWith({ jsonrpc: "2.0", method: "mausbot/point", params: { on: false } }, "*");
  });

  it("shares the version on screen, then shows the link with Copy and opens it in a new tab", async () => {
    await render(row(payload()));
    await click("Share", card());
    await settle();
    const sent = fetchMock.mock.calls.find(([path, init]) => path.endsWith("/app/publish") && init?.method === "POST")!;
    expect(JSON.parse(String(sent[1]!.body))).toEqual({ rev: 0 });
    expect(card().querySelector("[data-page-link]")?.textContent).toContain(LINK);
    expect(button("Copy link", card())).toBeDefined();
    expect(button("Open in new tab", card()).disabled).toBe(false);
    await click("Open in new tab", card());
    expect(openExternal).toHaveBeenCalledWith(LINK);
    await click("Update link", card());
    await settle();
    expect(card().querySelector("[data-page-link]")?.textContent).toContain("Updated at the same link");
  });

  it("knows a page shared before, when the card comes back", async () => {
    published = { pageId: "page000000000000000000001", url: LINK };
    await render(row(payload()));
    expect(card().querySelector("[data-page-link]")?.textContent).toContain("Published");
    expect(button("Open in new tab", card()).disabled).toBe(false);
  });

  it("opens Full screen over the chat, points there too, and closes on Escape or after a pick", async () => {
    await render(row(payload()));
    await click("Full screen", card());
    expect(overlay()?.getAttribute("role")).toBe("dialog");
    expect(wideFrame().style.height).toBe("100%");
    expect(card().querySelector("iframe")).toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(overlay()).toBeNull();
    await settle();
    expect(inlineFrame()).toBeTruthy();

    await click("Full screen", card());
    vi.spyOn(wideFrame().contentWindow!, "postMessage").mockImplementation(() => {});
    await click("Point", overlay()!);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(overlay()).not.toBeNull();
    await click("Point", overlay()!);
    await fromFrame(PICK, wideFrame().contentWindow);
    expect(chips()).toHaveLength(1);
    expect(overlay()).toBeNull();
  });

  it("gives an MCP app none of a page's tools", async () => {
    await render(row(payload({ source: "mcp", mcp: { server: "excalidraw", tool: "create_view", resourceUri: "ui://excalidraw/app.html" } })));
    expect(card().querySelector("[data-page-tools]")).toBeNull();
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/app/publish"))).toBe(false);
  });
});

describe("pointed chips", () => {
  const chip = (selector: string) => ({ appId: "a1", rev: 0, title: "Pricing", tag: "div", role: "", text: selector, selector, html: "<div></div>" });

  it("keep one chip per part, the newest few, and go with one send or come back when it fails", () => {
    for (const selector of ["a", "b", "a"]) addPointedChip("t1", chip(selector));
    expect(takePointedChips("t2")).toBeNull();
    const taken = takePointedChips("t1")!;
    expect(taken.pointed.map((element) => element.selector)).toEqual(["b", "a"]);
    expect(taken.pointed[0]).not.toHaveProperty("title");
    expect(takePointedChips("t1")).toBeNull();
    taken.restore();
    expect(takePointedChips("t1")!.pointed).toHaveLength(2);
    for (let n = 0; n < POINT_LIMITS.perMessage + 2; n += 1) addPointedChip("t1", chip(`s${n}`));
    expect(takePointedChips("t1")!.pointed.map((element) => element.selector)).toEqual(["s2", "s3", "s4", "s5", "s6"]);
  });
});
