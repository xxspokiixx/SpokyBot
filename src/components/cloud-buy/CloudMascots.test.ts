// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAUS_COLOR_NAMES } from "@/lib/mascot";

type Seen = { color: string; state: string; animated: boolean; trackPointer?: boolean; size: number };
vi.mock("@/components/Avatar", () => ({
  MausAvatar: ({ color, state, animated, trackPointer, size, ...choreography }: Seen) => createElement("i", {
    "data-maus": color, "data-state": state, "data-animated": String(animated), "data-pointer": String(trackPointer), "data-size": String(size),
    "data-extra": Object.keys(choreography).join(",") }),
}));
const { CloudMascots } = await import("./CloudMascots");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const render = async (size?: number) => { await act(async () => { root.render(createElement(CloudMascots, size === undefined ? {} : { size })); }); };
const mark = () => host.querySelector<HTMLElement>("[data-cloud-mascots]")!;
const mascots = () => [...host.querySelectorAll<HTMLElement>("[data-maus]")];
const animated = () => mascots().map(node => node.dataset.animated);

beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("three of the app's own mascots in three colours, each in its own calm state, small and hidden from screen readers beside the name", async () => {
  await render();
  const colors = mascots().map(node => node.dataset.maus!);
  expect(colors).toHaveLength(3);
  expect(new Set(colors).size).toBe(3);
  for (const color of colors) expect(MAUS_COLOR_NAMES).toContain(color);
  expect(mascots().map(node => node.dataset.state)).toEqual(["working", "idle", "thinking"]);
  expect(mascots().map(node => node.dataset.extra), "no faces, gazes or motions laid on top").toEqual(["", "", ""]);
  expect(mascots().map(node => node.dataset.pointer), "they never follow the pointer").toEqual(["false", "false", "false"]);
  expect(mascots().map(node => node.dataset.size)).toEqual(["20", "20", "20"]);
  expect(mark().getAttribute("aria-hidden")).toBe("true");
  await render(22);
  expect(mascots().map(node => node.dataset.size)).toEqual(["22", "22", "22"]);
});

it("live, the only motion is the mascots' own: no timer or frame of its own", async () => {
  vi.useFakeTimers();
  await render();
  expect(mark().hasAttribute("data-paused")).toBe(false);
  expect(animated()).toEqual(["true", "true", "true"]);
  expect(vi.getTimerCount(), "no setTimeout, setInterval or requestAnimationFrame").toBe(0);
  const markup = host.innerHTML;
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(host.innerHTML, "nothing changes on a clock").toBe(markup);
});

it("reduced motion holds them still", async () => {
  document.documentElement.dataset.reducedMotion = "true";
  await render();
  expect(animated()).toEqual(["false", "false", "false"]);
  expect(mark().hasAttribute("data-paused")).toBe(true);
});

it("the system setting or the dev hook, switched while they are shown, stills them at once and lets them go again", async () => {
  let reduce = false;
  const changes = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: reduce && query.includes("reduce"), media: query,
    addEventListener: (_: string, changed: () => void) => changes.add(changed), removeEventListener: (_: string, changed: () => void) => changes.delete(changed) }) as unknown as MediaQueryList);
  const still = () => animated().every(flag => flag === "false");
  const moving = () => animated().every(flag => flag === "true");
  await render();
  expect(moving()).toBe(true);
  reduce = true;
  await act(async () => { changes.forEach(changed => changed()); });
  expect(still(), "system setting on").toBe(true);
  reduce = false;
  await act(async () => { changes.forEach(changed => changed()); });
  expect(moving(), "system setting off").toBe(true);
  await act(async () => { document.documentElement.dataset.reducedMotion = "true"; await Promise.resolve(); });
  expect(still(), "dev hook on").toBe(true);
  await act(async () => { delete document.documentElement.dataset.reducedMotion; await Promise.resolve(); });
  expect(moving(), "dev hook off").toBe(true);
});

it("out of view they hold still until they are back", async () => {
  let visible: (seen: boolean) => void = () => {};
  vi.stubGlobal("IntersectionObserver", class {
    constructor(report: IntersectionObserverCallback) {
      visible = seen => report([{ isIntersecting: seen } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect() {}
  });
  await render();
  expect(animated()).toEqual(["true", "true", "true"]);
  await act(async () => visible(false));
  expect(mark().hasAttribute("data-paused")).toBe(true);
  expect(animated()).toEqual(["false", "false", "false"]);
  await act(async () => visible(true));
  expect(mark().hasAttribute("data-paused")).toBe(false);
  expect(animated()).toEqual(["true", "true", "true"]);
});
