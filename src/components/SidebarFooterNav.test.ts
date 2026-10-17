import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarDensity, SidebarToolsLayout } from "@/lib/sidebar-preferences";

const fixture = vi.hoisted(() => ({
  advanced: false,
  dispatch: vi.fn(),
  state: {} as Record<string, unknown>,
  toolsLayout: "rows" as SidebarToolsLayout,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarToolsLayout: () => fixture.toolsLayout,
}));
import { SidebarAppsButton, SidebarFooterNav, SidebarTriggersRow } from "./SidebarFooterNav";

type Props = { children?: ReactNode; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as ReactElement<Props>;
    return [node, ...nodes(node.props.children)];
  });
}
function render(density: SidebarDensity, { toolsLayout = "rows", ...extra }: { collapsed?: boolean; onToggleCollapsed?: () => void; toolsLayout?: SidebarToolsLayout } = {}) {
  fixture.toolsLayout = toolsLayout;
  let tree!: ReturnType<typeof SidebarFooterNav>;
  function Capture() { tree = SidebarFooterNav({ density, onToggleCollapsed: () => {}, ...extra }); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}

beforeEach(() => {
  fixture.advanced = false;
  fixture.dispatch.mockReset();
  fixture.state = { activeView: "chat", routineRuns: [], pluginsOpen: false };
  fixture.toolsLayout = "rows";
  vi.stubGlobal("window", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("sidebar footer places", () => {
  it.each(["comfortable", "compact"] as const)("keeps Team map in Advanced mode, with Apps beside the profile instead and no Routines or Automations row (%s)", (density) => {
    fixture.advanced = true;
    const { html } = render(density);
    expect(html).toContain('data-sidebar-nav="team-map"');
    expect(html).not.toContain('data-sidebar-nav="routines"');
    expect(html).not.toContain('data-sidebar-nav="triggers"');
    expect(html).not.toContain('data-sidebar-nav="apps"');
  });

  it.each(["comfortable", "compact"] as const)("draws no place rows at all in Simple mode (%s)", (density) => {
    const { html } = render(density);
    expect(html).toBe("");
  });

  it("keeps Simple mode's Apps on the avatars-only rail", () => {
    const { html } = render("icons");
    expect(html).toContain('aria-label="Apps" title="Apps"');
    expect(html).not.toContain('data-sidebar-nav="triggers"');
  });

  it("shows Team map as its own row in Advanced mode, with no Tools menu", () => {
    fixture.advanced = true;
    const { nodes: tree, html } = render("comfortable");
    expect(html).toContain(">Team map</span>");
    expect(html).not.toContain("aria-haspopup");
    const row = tree.find((node) => node.props.id === "team-map")!;
    (row.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "showTeamMap" });
  });
});

describe("Automations, first in the sidebar", () => {
  function renderRow(density: SidebarDensity) {
    let tree!: ReturnType<typeof SidebarTriggersRow>;
    function Capture() { tree = SidebarTriggersRow({ density }); return tree; }
    return { html: renderToStaticMarkup(createElement(Capture)), nodes: nodes(tree) };
  }

  it.each([[false, "comfortable"], [false, "compact"], [true, "comfortable"], [true, "icons"]] as const)("is one row in Simple and Advanced mode alike (advanced: %s, %s)", (advanced, density) => {
    fixture.advanced = advanced;
    const { html } = renderRow(density);
    expect(html).toMatch(/data-tour="nav-automations" data-sidebar-nav="triggers"/);
    expect(html).toContain(density === "icons" ? 'aria-label="Automations" title="Automations"' : ">Automations</span>");
  });

  it("opens the Automations list through the store, and marks it current while open", () => {
    const { nodes: tree } = renderRow("comfortable");
    (tree.find((node) => node.props.id === "triggers")!.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "showRoutines", view: "list" });
    fixture.state.activeView = "routines";
    expect(renderRow("comfortable").html).toContain('aria-current="page"');
  });

  it("carries the dot for an unseen failed run, and clears it once seen", () => {
    fixture.state.routineRuns = [{ id: "r", status: "failed", scheduledFor: 1 }];
    expect(renderRow("comfortable").html).toContain('data-testid="routines-attention"');
    fixture.state.routineRuns = [{ id: "r", status: "failed", scheduledFor: 1, seenAt: 1 }];
    expect(renderRow("comfortable").html).not.toContain('data-testid="routines-attention"');
  });
});

describe("Tools header", () => {
  it.each(["comfortable", "compact"] as const)("labels the places with a Tools header, expanded by default (%s)", (density) => {
    fixture.advanced = true;
    const { html } = render(density);
    expect(html).toContain(">Tools<");
    expect(html).toContain('aria-expanded="true"');
    expect(html.indexOf(">Tools<")).toBeLessThan(html.indexOf('data-sidebar-nav="team-map"'));
  });

  it("keeps the Tools label and hides the rows when collapsed", () => {
    fixture.advanced = true;
    const { html } = render("comfortable", { collapsed: true });
    expect(html).toContain(">Tools<");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-sidebar-nav="team-map"');
  });

  it("toggles through the header", () => {
    fixture.advanced = true;
    const onToggleCollapsed = vi.fn();
    const { nodes: tree } = render("comfortable", { onToggleCollapsed });
    const header = tree.find((node) => typeof node.props.onToggle === "function")!;
    (header.props.onToggle as () => void)();
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("puts no failed-routine dot on the Tools header: it lives on the Automations row", () => {
    fixture.advanced = true;
    fixture.state.routineRuns = [{ id: "r", status: "failed", scheduledFor: 1 }];
    expect(render("comfortable", { collapsed: true }).html).not.toContain('data-testid="section-alert"');
    expect(render("comfortable").html).not.toContain('data-testid="routines-attention"');
  });

  it("draws no Tools header in the avatars-only density or in Simple mode", () => {
    fixture.advanced = true;
    expect(render("icons").html).not.toContain(">Tools<");
    fixture.advanced = false;
    expect(render("comfortable").html).toBe("");
  });

  it("keeps the guided tour's tools anchor on the header and rows together", () => {
    fixture.advanced = true;
    expect(render("comfortable").html).toContain('data-tour="tools"');
    expect(render("comfortable", { collapsed: true }).html).toContain('data-tour="tools"');
  });
});

describe("Apps beside the profile", () => {
  it.each([false, true])("is one icon button that opens Apps and carries the tour's Apps anchor (advanced: %s)", (advanced) => {
    fixture.advanced = advanced;
    let tree!: ReturnType<typeof SidebarAppsButton>;
    function Capture() { tree = SidebarAppsButton(); return tree; }
    const html = renderToStaticMarkup(createElement(Capture));
    expect(html).toMatch(/data-tour="nav-apps" data-sidebar-nav="apps"/);
    expect(html).toContain('aria-label="Apps"');
    (tree.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "togglePlugins", open: true });
  });
});

describe("toolbar tools layout", () => {
  it.each(["comfortable", "compact"] as const)("toolbar renders the places as icon buttons with labels (%s)", (density) => {
    fixture.advanced = true;
    const { html } = render(density, { toolsLayout: "toolbar" });
    expect(html).toContain('class="flex flex-row gap-1"');
    expect(html).not.toContain("flex-col");
    expect(html).toContain('aria-label="Team map" title="Team map"');
    expect(html).not.toContain(">Team map</span>");
  });

  it("toolbar keeps tour anchors and aria-current", () => {
    fixture.advanced = true;
    fixture.state.activeView = "team-map";
    const { html } = render("comfortable", { toolsLayout: "toolbar" });
    expect(html).toContain('data-tour="tools"');
    expect(html).toMatch(/data-tour="team-tools" data-sidebar-nav="team-map"/);
    expect(html).toContain('aria-current="page"');
  });

  it("toolbar shows Team map only in Advanced mode", () => {
    fixture.advanced = true;
    expect(render("comfortable", { toolsLayout: "toolbar" }).html.match(/data-sidebar-nav="/g)).toHaveLength(1);
    fixture.advanced = false;
    expect(render("comfortable", { toolsLayout: "toolbar" }).html).toBe("");
  });

  it("icons density ignores the tools layout", () => {
    fixture.advanced = true;
    const rows = render("icons").html;
    expect(render("icons", { toolsLayout: "toolbar" }).html).toBe(rows);
    expect(rows).toContain('class="flex flex-col items-center gap-1"');
  });

  it("rows layout renders exactly as before", () => {
    fixture.advanced = true;
    const unset = render("comfortable").html;
    expect(render("comfortable", { toolsLayout: "rows" }).html).toBe(unset);
    expect(unset).toContain('<div data-tour="tools">');
    expect(unset).toContain('<nav aria-label="Tools" class="flex flex-col gap-0.5">');
    expect(unset).not.toContain("flex-row");
    expect(unset).toContain(">Team map</span>");
    expect(unset).not.toContain('title="Team map"');
  });
});
