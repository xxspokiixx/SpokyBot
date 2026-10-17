import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";

// Hook-by-call-order harness: the page's own state survives between captures, so a click then a fresh capture shows
// what renders next. Effects never run.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return {
    advanced: false,
    values: [] as unknown[],
    index: 0,
    state: undefined as AppState | undefined,
    dispatch: vi.fn(),
    api: vi.fn(() => new Promise(() => {})),
  };
});
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: fixture.api, useStore: () => ({ state: fixture.state ?? original.initialState, dispatch: fixture.dispatch }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { initialState } = await import("@/state/store");
const { EventDetails, EventEditor } = await import("./RoutineCalendarPage");
const { TriggersPage: RoutinesPage } = await import("./TriggersPage");
const { calendarRangeLabel, startOfWeek } = await import("@/lib/routine-calendar");
const { scheduleLabel } = await import("@/lib/schedule-label");

afterAll(() => vi.unstubAllGlobals());

const bot: Bot = {
  id: "runner", threadId: "runner-main", name: "Runner", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
  tasks: [{ threadId: "brief-thread", title: "Morning briefs", createdAt: 1 }],
};
const routine: Routine = {
  id: "brief", name: "Morning brief", prompt: "Summarise my inbox and calendar.", target: "bot", botId: bot.id,
  runOn: "maus", enabled: true, schedule: { type: "daily", time: "06:30", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  durationMinutes: 30, nextRunAt: Date.now() + 3_600_000, createdAt: 0, updatedAt: 0, resultsThreadId: "brief-thread",
};
const cronRoutine: Routine = {
  ...routine, id: "cron", name: "Office hours check", schedule: { type: "cron", expression: "*/20 9-17 * * 1-5", timeZone: "UTC" },
};
const runAt = (day: number, status: RoutineRun["status"]): RoutineRun => ({
  id: `run-${day}`, routineId: routine.id, routineName: routine.name, target: "bot", botId: bot.id, runOn: "maus",
  scheduledFor: day * 86_400_000, createdAt: day * 86_400_000, startedAt: day * 86_400_000,
  finishedAt: day * 86_400_000 + 95_000, status, manual: false,
});
const runs = [runAt(1, "completed"), { ...runAt(2, "failed"), seenAt: 1 }, runAt(3, "completed"), runAt(4, "completed")];

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(value: ReactNode): Node[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as Node;
    return [node, ...nodes(node.props.children)];
  });
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return Children.toArray(node).map((child) => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : textOf(child)).join("");
}
const named = (name: string) => (node: Node) => typeof node.type === "function" && node.type.name === name;

function capture(render: () => ReactNode): Node[] {
  let tree: Node[] = [];
  function Capture() { fixture.index = 0; tree = nodes(render()); return null; }
  renderToStaticMarkup(createElement(Capture));
  return tree;
}
const page = () => capture(() => RoutinesPage({ onBack: vi.fn(), onOpenRoom: vi.fn() }));
function buttons(tree: Node[]): Map<string, Node["props"]> {
  const map = new Map<string, Node["props"]>();
  for (const node of tree) {
    if (node.type !== "button") continue;
    const props = node.props as { "aria-label"?: string; title?: string; children?: ReactNode };
    map.set(props["aria-label"] ?? props.title ?? textOf(props.children), node.props);
  }
  return map;
}
function markup(element: ReactElement): string {
  fixture.values = [];
  fixture.index = 0;
  return renderToStaticMarkup(element);
}
const click = (props: Node["props"] | undefined) => (props!.onClick as () => void)();

function details(item: Parameters<typeof EventDetails>[0]["item"]) {
  const props = { item, bots: [bot], onClose: vi.fn(), onEdit: vi.fn(), onCallChanged: vi.fn(), onOpenRoom: vi.fn(), onOpenRun: vi.fn() };
  return { props, tree: capture(() => EventDetails(props)), html: markup(createElement(EventDetails, props)) };
}
const routineItem = (definition: Routine, run: RoutineRun | null = null) =>
  ({ kind: "routine" as const, id: `next-${definition.id}`, at: definition.nextRunAt ?? 0, durationMinutes: 30, routine: definition, run });

beforeEach(() => {
  fixture.advanced = false;
  fixture.values = [];
  fixture.index = 0;
  fixture.dispatch.mockClear();
  fixture.api.mockClear();
  fixture.state = { ...initialState, bots: [bot], routines: [routine], routineRuns: runs };
});

describe("Triggers header", () => {
  const startingWith = (tree: Node[], text: string) => [...buttons(tree).entries()].find(([label]) => label.startsWith(text))?.[1];

  it("shows the title, the list first, the view switch, History and New trigger", () => {
    const tree = page();
    const header = buttons(tree);
    expect(tree.some((node) => node.type === "h1" && textOf(node.props.children) === "Triggers")).toBe(true);
    for (const label of ["List", "Day", "Week", "History", "New trigger"]) {
      expect(header.has(label), label).toBe(true);
    }
    expect(header.get("List")!["aria-pressed"]).toBe(true);
    expect(tree.find(named("RoutineList"))).toBeDefined();
    expect(header.has("Previous dates")).toBe(false);
  });

  it("switches between List, Day and Week, with dates only on the calendar", () => {
    let tree = page();
    expect(tree.find(named("CalendarGrid"))).toBeUndefined();
    click(buttons(tree).get("Day"));
    tree = page();
    expect(tree.find(named("CalendarGrid"))!.props.days).toBe(1);
    expect(buttons(tree).get("Day")!["aria-pressed"]).toBe(true);
    expect(buttons(tree).has("Previous dates")).toBe(true);
    click(buttons(tree).get("Week"));
    tree = page();
    expect(tree.find(named("CalendarGrid"))!.props.days).toBe(7);
    expect(tree.some((node) => textOf(node.props.children) === calendarRangeLabel(startOfWeek(Date.now()), 7))).toBe(true);
    click(buttons(tree).get("List"));
    tree = page();
    expect(tree.find(named("CalendarGrid"))).toBeUndefined();
    expect(tree.find(named("RoutineList"))).toBeDefined();
  });

  it("keeps the run history one click away", () => {
    click(buttons(page()).get("History"));
    expect(page().find(named("RoutineLogs"))).toBeDefined();
  });

  it("lists webhooks with the schedules, filtered by kind, with no separate Webhooks tab", () => {
    fixture.state = { ...fixture.state!, webhooks: [{ id: "hook", endpointId: "wh_x", name: "Interested replies", prompt: "", botId: bot.id, runOn: "maus", enabled: true, createdAt: 0, updatedAt: 0, deliveryCount: 0 }] };
    let tree = page();
    expect(buttons(tree).has("Webhooks")).toBe(false);
    expect(tree.find(named("RoutineList"))).toBeDefined();
    expect(tree.find(named("WebhookTriggerList"))!.props.webhooks).toHaveLength(1);
    click(startingWith(tree, "Webhooks"));
    tree = page();
    expect(tree.find(named("RoutineList"))).toBeUndefined();
    expect(tree.find(named("WebhookTriggerList"))).toBeDefined();
    click(startingWith(tree, "Schedules"));
    tree = page();
    expect(tree.find(named("RoutineList"))).toBeDefined();
    expect(tree.find(named("WebhookTriggerList"))).toBeUndefined();
  });

  it("asks what starts a new trigger, then opens the plain schedule editor in Simple mode", () => {
    click(buttons(page()).get("New trigger"));
    const menu = page();
    expect(startingWith(menu, "When another app calls a link")).toBeDefined();
    click(startingWith(menu, "On a schedule"));
    expect(page().find(named("EventEditor"))!.props.seed).toMatchObject({ kind: "routine", botIds: [] });
  });

  it("opens the webhook editor from When another app calls a link", () => {
    click(buttons(page()).get("New trigger"));
    click(startingWith(page(), "When another app calls a link"));
    expect(page().find(named("WebhookEditor"))!.props.webhook).toBeUndefined();
  });

  it("greets an empty workspace with what a trigger is and how to ask a bot for one", () => {
    fixture.state = { ...fixture.state!, routines: [], webhooks: [], routineRuns: [], routinesLoadState: "ready" };
    const html = markup(createElement(RoutinesPage, { onBack: vi.fn(), onOpenRoom: vi.fn() }));
    expect(html).toContain("No triggers yet");
    expect(html).toContain("Try telling a bot");
  });
});

describe("routine drawer", () => {
  it("opens beside the grid when an occurrence is selected and rings it", () => {
    click(buttons(page()).get("Week"));
    let tree = page();
    const grid = tree.find(named("CalendarGrid"))!;
    const item = routineItem(routine);
    (grid.props.onOpen as (value: unknown) => void)(item);
    tree = page();
    expect(tree.find(named("EventDetails"))!.props.item).toMatchObject({ id: item.id, routine: { id: routine.id } });
    expect(tree.find(named("CalendarGrid"))!.props.selectedId).toBe(item.id);
  });

  it("shows bot, plain schedule, instructions, where it runs, results and the last three runs", () => {
    const { html } = details(routineItem(routine));
    for (const text of ["Bot", "Runner", "Schedule", scheduleLabel(routine.schedule), "What to do", routine.prompt,
      "Runs on", "This computer", "Post results to", "Morning briefs", "Run logs", "Active"]) {
      expect(html, text).toContain(text);
    }
    expect(html.match(/aria-label="Open Morning brief run:/g)).toHaveLength(3);
    expect(html).toContain("2 min");
  });

  it("opens a recent run in place", () => {
    const { props, tree } = details(routineItem(routine));
    const rows = tree.filter(named("RecentRunRow"));
    expect(rows.map((row) => (row.props.run as RoutineRun).id)).toEqual(["run-4", "run-3", "run-2"]);
    (rows[0]!.props.onOpen as () => void)();
    expect(props.onOpenRun).toHaveBeenCalledWith(runs[3]);
  });

  it("describes the Boat runner in plain words", () => {
    expect(details(routineItem({ ...routine, runOn: "cloud" })).html).toContain("Cloud computer");
  });

  it("Run now and Pause send the same requests as before", () => {
    const { tree } = details(routineItem(routine));
    const controls = buttons(tree);
    click(controls.get("Run now"));
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "runRoutine", routineId: routine.id }));
    click(controls.get("Pause routine"));
    expect(fixture.api).toHaveBeenCalledWith(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  });

  it("offers Resume and a Paused pill for a paused routine", () => {
    const pausedRoutine = { ...routine, enabled: false };
    fixture.state = { ...fixture.state!, routines: [pausedRoutine] };
    const { tree, html } = details(routineItem(pausedRoutine));
    expect(html).toContain("Paused");
    click(buttons(tree).get("Resume routine"));
    expect(fixture.api).toHaveBeenCalledWith(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
  });

  it("shows a cron routine's schedule sentence", () => {
    expect(details(routineItem(cronRoutine)).html).toContain(scheduleLabel(cronRoutine.schedule));
  });

  it("keeps Edit and the results thread", () => {
    const { props, tree } = details(routineItem(routine));
    const controls = buttons(tree);
    expect(controls.has("Open results thread")).toBe(true);
    click(controls.get("Edit"));
    expect(props.onEdit).toHaveBeenCalledOnce();
  });
});

describe("routine editor", () => {
  const editor = (routineToEdit?: Routine) => markup(createElement(EventEditor, {
    seed: { kind: "routine", at: Date.now() + 3_600_000, durationMinutes: 30, botIds: [bot.id], routine: routineToEdit },
    bots: [bot], onClose: vi.fn(), onSavedCall: vi.fn(),
  }));
  const hidden = ['<select aria-label="Repeat"', "Routine safety limit", "Runs the whole job on the bot&#x27;s cloud computer", "Add attachment", "Post results to", "Routine type"];

  it("keeps Simple mode to the basics with everything else behind More options", () => {
    const html = editor();
    for (const text of ["New routine", 'placeholder="What should happen?"', "Who does it", "When", "Once", "Every day", "Weekdays", "Every week", "More options"]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('aria-expanded="false"');
    for (const text of hidden) expect(html, text).not.toContain(text);
  });

  it("marks the routine's repeat choice", () => {
    expect(editor(routine)).toMatch(/aria-pressed="true"[^>]*>Every day</);
  });

  it("opens More options for a schedule the basics cannot show", () => {
    const html = editor(cronRoutine);
    expect(html).toContain('aria-expanded="true"');
    for (const text of hidden.filter((text) => text !== "Routine type")) expect(html, text).toContain(text);
    expect(html).not.toMatch(/aria-pressed="true"/);
  });

  it("shows a saved startup choice when the simple editor opens", () => {
    const html = editor({ ...routine, runOnStartup: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/<input type="checkbox" aria-label="Also run when OpenMausBot starts"[^>]*checked[^>]*>/);
  });

  it("offers Remember the last run for a repeating routine, off unless the routine has it", () => {
    expect(editor(routine)).toMatch(/<input type="checkbox" aria-label="Remember the last run"(?![^>]*checked)[^>]*>/);
    expect(editor({ ...routine, continuity: true })).toMatch(/<input type="checkbox" aria-label="Remember the last run"[^>]*checked[^>]*>/);
    expect(editor(routine)).toContain("Each run starts with the previous run&#x27;s report");
  });

  it("hides Remember the last run for a one-time routine", () => {
    expect(editor()).not.toContain("Remember the last run");
  });

  it("saves the switch with the routine, and turning it off saves false", () => {
    const props = {
      seed: { kind: "routine" as const, at: Date.now() + 3_600_000, durationMinutes: 30, botIds: [bot.id], routine },
      bots: [bot], onClose: vi.fn(), onSavedCall: vi.fn(),
    };
    fixture.values = [];
    let tree = capture(() => EventEditor(props));
    const toggle = () => tree.find((node) => node.type === "input" && node.props["aria-label"] === "Remember the last run")!;
    (toggle().props.onChange as (event: unknown) => void)({ target: { checked: true } });
    tree = capture(() => EventEditor(props));
    expect(toggle().props.checked).toBe(true);
    click(buttons(tree).get("Save"));
    const [path, init] = fixture.api.mock.calls.at(-1) as unknown as [string, { method: string; body: string }];
    expect(path).toBe(`/api/routines/${routine.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toMatchObject({ continuity: true });

    fixture.values = [];
    const on = { ...props, seed: { ...props.seed, routine: { ...routine, continuity: true } } };
    tree = capture(() => EventEditor(on));
    (toggle().props.onChange as (event: unknown) => void)({ target: { checked: false } });
    tree = capture(() => EventEditor(on));
    click(buttons(tree).get("Save"));
    const [, off] = fixture.api.mock.calls.at(-1) as unknown as [string, { body: string }];
    expect(JSON.parse(off.body)).toMatchObject({ continuity: false });
  });

  it("shows a routine with no thread of its own reporting into the bot's main thread", () => {
    fixture.advanced = true;
    const { resultsThreadId: _chosen, ...unchosen } = routine;
    const destination = (html: string) => html.slice(html.indexOf("Post results to")).match(/^[\s\S]*?<\/select>/)![0];
    expect(destination(editor(unchosen))).toContain('<option value="new" selected="">The bot&#x27;s main thread</option>');
    expect(destination(editor(routine))).toContain('<option value="brief-thread" selected="">Morning briefs</option>');
  });

  it("leaves the Advanced editor as it was", () => {
    fixture.advanced = true;
    const html = editor();
    for (const text of ['placeholder="Add title"', '<select aria-label="Repeat"', "Assign a bot", "Runs the whole job on the bot&#x27;s cloud computer", "Post results to", "Routine type", "New event"]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("More options");
    expect(html).not.toContain("What should happen?");
  });
});
