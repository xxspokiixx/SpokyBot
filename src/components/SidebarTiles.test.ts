import { Children, createElement, isValidElement, type KeyboardEvent, type MemoExoticComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialState, type Bot } from "@/state/store";

vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => false,
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));

import { botRowProps } from "./Sidebar";
import { SidebarBotTile } from "./SidebarTiles";

const bot = (extra: Partial<Bot> = {}): Bot => ({
  id: "mausbot", threadId: "t", name: "MausBot", title: "", description: "", notifications: true, color: "chrome",
  unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const dispatch = vi.fn();
const onMenu = vi.fn();
const props = (candidate: Bot, selected = false) => botRowProps({ ...initialState, bots: [candidate], selectedId: selected ? candidate.id : "", activeView: "chat" }, dispatch, candidate, { density: "comfortable", quiet: false, query: "", onMenu });
const tile = (SidebarBotTile as MemoExoticComponent<(props: Parameters<typeof SidebarBotTile>[0]) => ReactNode>).type;

type Props = { children?: ReactNode; [key: string]: unknown };
function find(tree: ReactNode, attribute: string): ReactElement<Props> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<Props>(child)) continue;
    if (child.props[attribute] !== undefined) return child;
    const found = find(child.props.children, attribute);
    if (found) return found;
  }
}

beforeEach(() => {
  dispatch.mockClear();
  onMenu.mockClear();
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal("HTMLInputElement", class {});
});
afterEach(() => vi.unstubAllGlobals());

describe("the sidebar tiles", () => {
  it("draws the main bot as a 94 to 120px tile with a 56px avatar, its name below and the Chief's badge", () => {
    const html = renderToStaticMarkup(createElement(SidebarBotTile, { ...props(bot({ chiefOfStaff: true })), primary: true }));
    expect(html).toMatch(/data-sidebar-tile="primary"[^>]*class="[^"]*\bh-\[92px\][^"]*\bmin-w-\[94px\][^"]*\bmax-w-\[120px\]/);
    expect(html).toContain("rounded-[14px]");
    expect(html).toContain('width="56px" height="56px"');
    expect(html).toContain('data-testid="chief-badge"');
    expect(html).toMatch(/text-\[13px\] leading-4 text-ink"[^>]*>MausBot</);
    expect(html).toContain('title="MausBot · Chief of Staff"');
    expect(html).not.toContain("data-provider-mark");
  });

  it("draws a pinned bot as an 84px tile with a 48px avatar, and a badge only for a Chief", () => {
    const html = renderToStaticMarkup(createElement(SidebarBotTile, props(bot({ id: "scout", name: "Scout" }))));
    expect(html).toMatch(/data-sidebar-tile="pinned"[^>]*class="[^"]*\bh-\[84px\][^"]*\bw-\[84px\]/);
    expect(html).toContain('width="48px" height="48px"');
    expect(html).not.toContain('data-testid="chief-badge"');
  });

  it("fills the selected tile and marks it current, and shows working, waiting and unread as a dot on the avatar", () => {
    const selected = renderToStaticMarkup(createElement(SidebarBotTile, { ...props(bot(), true), primary: true }));
    expect(selected).toContain('aria-current="page"');
    expect(selected).toContain("[--tile:var(--color-raised)]");
    expect(renderToStaticMarkup(createElement(SidebarBotTile, props(bot({ busy: true }))))).toContain('data-testid="working-dot"');
    expect(renderToStaticMarkup(createElement(SidebarBotTile, props(bot({ activity: "waiting-on-you" }))))).toContain('data-testid="waiting-dot"');
    const unread = renderToStaticMarkup(createElement(SidebarBotTile, props(bot({ unread: true }))));
    expect(unread).toContain('data-testid="unread-dot"');
    expect(unread).toContain('aria-label="MausBot · Unread"');
  });

  it("opens the bot on Enter and its menu from the ContextMenu key", () => {
    let tree: ReactNode;
    function Capture() { tree = tile({ ...props(bot()), primary: true }); return tree; }
    renderToStaticMarkup(createElement(Capture));
    const element = find(tree, "data-sidebar-tile")!;
    const key = (name: string) => (element.props.onKeyDown as (event: KeyboardEvent) => void)({
      key: name, shiftKey: false, preventDefault: vi.fn(), currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 94, height: 92 }) },
    } as unknown as KeyboardEvent);
    key("Enter");
    expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "mausbot" });
    key("ContextMenu");
    expect(onMenu).toHaveBeenCalledWith({ botId: "mausbot", x: 57, y: 66 });
  });
});
