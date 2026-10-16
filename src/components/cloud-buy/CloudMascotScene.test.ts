// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { MAUS_COLOR_NAMES } from "@/lib/mascot";
import en from "@/locales/en.json";

type Seen = { color: string; state: string; animated: boolean; expression?: number; gaze?: { x: number; y: number } };
vi.mock("@/components/Avatar", () => ({
  MausAvatar: ({ color, state, animated, expression, gaze }: Seen) => createElement("i", {
    "data-maus": color, "data-state": state, "data-animated": String(animated), "data-face": expression ?? "", "data-gaze": gaze ? `${gaze.x},${gaze.y}` : "" }),
}));
const { CloudMascotScene } = await import("./CloudMascotScene");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ANIMATED = /\bcloud-scene-(?:twinkle|meteor|float|drift|led|z|hop|token|bit)\b/;
let host: HTMLDivElement, root: Root;
const render = async (props: { variant: "hero" | "beat"; paused?: boolean }) => { await act(async () => { root.render(createElement(CloudMascotScene, props)); }); };
/** Each phase sets its timer in an effect after the render, so the clock moves in steps React can flush between. */
const advance = async (ms: number) => { for (let left = ms; left > 0; left -= 10) await act(async () => { vi.advanceTimersByTime(Math.min(10, left)); }); };
const scene = () => host.querySelector<HTMLElement>("[data-cloud-scene]")!;
const mascots = () => [...host.querySelectorAll<HTMLElement>("[data-maus]")];
const mascot = (color: string) => host.querySelector<HTMLElement>(`[data-maus="${color}"]`)!;
const animatedParts = () => [...host.querySelectorAll("[class]")].filter(node => ANIMATED.test(node.getAttribute("class")!));
const named = (selector: string, attribute: string) => [...host.querySelectorAll(selector)].map(node => node.getAttribute(attribute));
const thinking = () => named("[data-thought][data-on]", "data-thought");
const tokens = () => named("[data-token]", "data-token");
const hopping = () => named(".cloud-scene-hop [data-maus]", "data-maus");
const looking = (color: string) => mascot(color).dataset.gaze!.split(",").map(Number) as [number, number];

beforeEach(() => { setLocale("en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("four of the app's own mascots in four colours, one picture named for its message", async () => {
  for (const variant of ["hero", "beat"] as const) {
    await render({ variant });
    const colors = mascots().map(node => node.dataset.maus!);
    expect(colors, variant).toHaveLength(4);
    expect(new Set(colors).size, variant).toBe(4);
    for (const color of colors) expect(MAUS_COLOR_NAMES).toContain(color);
    expect(scene().dataset.cloudScene).toBe(variant);
    expect(scene().getAttribute("role")).toBe("img");
    expect(scene().getAttribute("aria-label")).toBe(en["cloudScene.label"]);
  }
  expect(en["cloudScene.label"]).toMatch(/keep working .* while this computer sleeps$/);
});

it("reduced motion is one still frame of the whole story: no CSS animation and no mascot moving", async () => {
  document.documentElement.dataset.reducedMotion = "true";
  await render({ variant: "hero" });
  expect(scene().hasAttribute("data-still")).toBe(true);
  expect(mascots().map(node => node.dataset.animated)).toEqual(["false", "false", "false", "false"]);
  expect(animatedParts()).toEqual([]);
  expect(tokens(), "a finished task hangs in the sky").toEqual(["pink"]);
  expect(named("[data-burst]", "data-burst"), "and another one has popped").toEqual(["green"]);
  expect(thinking(), "while a bot works on the next one").toEqual(["orange"]);
  expect(mascot("pink").dataset.face, "the finisher beams").toBe("2");
});

it("the system setting stills it too, and turning it on while the scene is shown stills it at once", async () => {
  let reduce = false;
  const changes = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: reduce && query.includes("reduce"), media: query,
    addEventListener: (_: string, changed: () => void) => changes.add(changed), removeEventListener: (_: string, changed: () => void) => changes.delete(changed) }) as unknown as MediaQueryList);
  await render({ variant: "beat" });
  expect(scene().hasAttribute("data-still")).toBe(false);
  expect(animatedParts().length).toBeGreaterThan(0);
  reduce = true;
  await act(async () => { changes.forEach(changed => changed()); });
  expect(scene().hasAttribute("data-still")).toBe(true);
  expect(animatedParts()).toEqual([]);
  expect(mascots().every(node => node.dataset.animated === "false")).toBe(true);
});

it("every 4.6 s one bot finishes: it hops with a happy face and sends its token up while the others watch, then the next one thinks", async () => {
  vi.useFakeTimers();
  await render({ variant: "hero" });
  expect(thinking(), "busy from the first frame").toEqual(["pink"]);
  expect(tokens()).toEqual([]);
  await advance(1300);
  expect(hopping()).toEqual(["pink"]);
  expect(tokens()).toEqual(["pink"]);
  expect(mascot("pink").dataset.face).toBe("2");
  expect(looking("pink")[1], "pink looks up at its token").toBeLessThan(0);
  expect(looking("orange"), "orange looks up and right").toEqual([expect.any(Number), expect.any(Number)]);
  expect(looking("orange")[0]).toBeGreaterThan(0); expect(looking("orange")[1]).toBeLessThan(0);
  expect(looking("green")[0]).toBeLessThan(0); expect(looking("green")[1]).toBeLessThan(0);
  expect(thinking()).toEqual([]);
  await advance(1200);
  expect(hopping()).toEqual([]);
  expect(mascot("pink").dataset.face).toBe("");
  await advance(800);
  expect(thinking()).toEqual(["green"]);
  expect(looking("orange")[1], "back to work").toBeGreaterThan(0);
  await advance(2600);
  expect(hopping()).toEqual(["green"]);
  expect(tokens()).toEqual(["green"]);
  await advance(4600);
  expect(hopping()).toEqual(["orange"]);
  expect(tokens()).toEqual(["orange"]);
  await advance(4600);
  expect(hopping()).toEqual(["pink"]);
});

it("paused or out of view it holds: the mascots stop, CSS animations hold and no task finishes until it is back", async () => {
  vi.useFakeTimers();
  let visible: (seen: boolean) => void = () => {};
  vi.stubGlobal("IntersectionObserver", class {
    constructor(report: IntersectionObserverCallback) {
      visible = seen => report([{ isIntersecting: seen } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect() {}
  });
  await render({ variant: "beat", paused: true });
  expect(scene().hasAttribute("data-paused")).toBe(true);
  expect(mascots().every(node => node.dataset.animated === "false")).toBe(true);
  await advance(20_000);
  expect(tokens()).toEqual([]);
  expect(thinking()).toEqual(["pink"]);
  await render({ variant: "beat" });
  expect(scene().hasAttribute("data-paused")).toBe(false);
  expect(mascots().every(node => node.dataset.animated === "true")).toBe(true);
  await advance(1300);
  expect(tokens()).toEqual(["pink"]);
  await act(async () => visible(false));
  expect(scene().hasAttribute("data-paused")).toBe(true);
  expect(mascots().every(node => node.dataset.animated === "false")).toBe(true);
  await advance(20_000);
  expect(hopping(), "held mid-hop").toEqual(["pink"]);
  await act(async () => visible(true));
  await advance(4600);
  expect(tokens()).toEqual(["green"]);
});
