import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudMoveBridge, CloudMoveOverview, CloudMoveState } from "../../electron/cloud-move.mjs";
import { setLocale } from "@/lib/i18n";
const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = initial; return [f.values[index], (next: unknown) => { f.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(f.values[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = { current: initial }; return f.values[index]; },
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
}));
import { CloudMoveSettings, CloudMoveSuggestion, cloudMoveErrorText } from "./CloudMove";

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>;
function nodes(value: ReactNode): Node[] { if (!isValidElement(value)) return []; const node = value as Node; return [node, ...Children.toArray(node.props.children).flatMap(nodes)]; }
function render(component: () => ReactNode) {
  f.index = 0; f.effects = []; let tree: ReactNode;
  function Capture() { tree = component(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const text = (node: Node) => Children.toArray(node.props.children).join("");
const button = (component: () => ReactNode, label: string) => render(component).nodes.find(node => node.type === "button" && text(node) === label);
const settings = () => CloudMoveSettings();
const suggestion = () => CloudMoveSuggestion();

let bridge: CloudMoveBridge, push: (state: CloudMoveState) => void;
const local = { bots: 4, rooms: 1, chats: 37, bytes: 1.5 * 1024 ** 3, files: 900 };
const emptyCloud = { contents: { bots: 1, rooms: 0, chats: 0 }, empty: true, freeBytes: 9 * 1024 ** 3, previous: null };
const overview = (extra: Partial<CloudMoveOverview> = {}): CloudMoveOverview => ({ phase: "idle", local, cloud: emptyCloud, suggest: false, ...extra });
beforeEach(() => {
  f.values = []; f.index = 0; f.effects = []; push = () => {};
  bridge = {
    state: vi.fn().mockResolvedValue(overview()), start: vi.fn().mockResolvedValue({ phase: "done" }), cancel: vi.fn().mockResolvedValue({ phase: "failed" }),
    restorePrevious: vi.fn().mockResolvedValue({ phase: "done" }), dismiss: vi.fn().mockResolvedValue(overview()),
    onState: vi.fn(callback => { push = callback; return () => {}; }),
  };
  vi.stubGlobal("window", { ogb: { platform: "darwin", cloudMove: bridge } }); setLocale("en");
});
afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });
async function ready(component: () => ReactNode, state = overview()) {
  vi.mocked(bridge.state).mockResolvedValue(state);
  render(component); f.effects[0](); await flush();
}

it("before a move, shows what moves and its size, that sign-ins stay here, and starts with one click sending nothing", async () => {
  await ready(settings);
  const { html } = render(settings);
  expect(html).toContain("Move to Cloud");
  expect(html).toContain("About 1.5 GB: 4 bots, 37 chats, 1 rooms.");
  expect(html).toContain("API keys and sign-ins stay on this computer");
  expect(html).toContain("sign in to Claude or ChatGPT");
  expect(html).not.toContain("replaces them");
  button(settings, "Move to Cloud")!.props.onClick!(); await flush();
  expect(bridge.start).toHaveBeenCalledExactlyOnceWith();
});

it("says plainly that a Cloud with work is replaced, backed up first, and can be put back", async () => {
  const previous = { createdAt: "2026-09-29T10:00:00.000Z", bots: 2, rooms: 0, chats: 5 };
  await ready(settings, overview({ cloud: { ...emptyCloud, empty: false, contents: { bots: 3, rooms: 1, chats: 12 }, previous } }));
  const { html } = render(settings);
  expect(html).toContain("Your Cloud already has 3 bots and 12 chats. Moving replaces them. They are backed up first");
  expect(button(settings, "Move to Cloud")).toBeUndefined();
  expect(button(settings, "Replace my Cloud with this computer&#x27;s workspace") ?? button(settings, "Replace my Cloud with this computer's workspace")).toBeTruthy();
  expect(html).toContain("2 bots, 5 chats");
  button(settings, "Restore previous Cloud")!.props.onClick!(); await flush();
  expect(bridge.restorePrevious).toHaveBeenCalledExactlyOnceWith();
  expect(bridge.start).not.toHaveBeenCalled();
});

it("without a session on the Cloud yet, still warns that anything there is replaced and backed up", async () => {
  await ready(settings, overview({ cloud: null }));
  expect(render(settings).html).toContain("If your Cloud already has bots or chats, moving replaces them");
});

it("while moving, shows the step and bytes and offers only Stop until the Cloud starts replacing", async () => {
  await ready(settings);
  push({ phase: "uploading", action: "move", progress: { bytesTransferred: 512 * 1024 ** 2, totalBytes: 1024 ** 3 } });
  let view = render(settings);
  expect(view.html).toContain("Uploading to your Cloud");
  expect(view.html).toContain("512 MB of 1 GB");
  expect(view.html).toContain("data-cloud-move=\"uploading\"");
  expect(button(settings, "Move to Cloud")).toBeUndefined();
  expect(button(settings, "Restore previous Cloud")).toBeUndefined();
  button(settings, "Stop the move")!.props.onClick!(); await flush();
  expect(bridge.cancel).toHaveBeenCalledExactlyOnceWith();
  push({ phase: "restarting", action: "move" });
  view = render(settings);
  expect(view.html).toContain("Your Cloud is restarting");
  expect(button(settings, "Stop the move")).toBeUndefined();
});

it("reports a full Cloud with both sizes, and continues a stopped upload", async () => {
  await ready(settings);
  push({ phase: "failed", action: "move", resumable: true, error: { code: "cloud_full", message: "", freeBytes: 2 * 1024 ** 3, neededBytes: 6 * 1024 ** 3 } });
  const { html } = render(settings);
  expect(html).toContain("Your Cloud has 2 GB free and this move needs about 6 GB. Nothing was moved.");
  expect(button(settings, "Continue the move")).toBeTruthy();
  expect(cloudMoveErrorText({ code: "restore_failed", message: "Wait for bot turns to finish." })).toBe("The move did not finish: Wait for bot turns to finish.");
});

it("reports what was moved when it is done", async () => {
  await ready(settings);
  push({ phase: "done", action: "move", moved: { bots: 4, rooms: 1, chats: 37 } });
  expect(render(settings).html).toContain("Moved to your Cloud: 4 bots and 37 chats.");
});

it("is not offered to a companion connected to another computer", async () => {
  vi.stubGlobal("window", { ogb: { cloudMove: bridge, remoteClient: { active: true } } });
  render(settings);
  expect(f.effects).toHaveLength(1);
  f.effects[0]();
  expect(bridge.state).not.toHaveBeenCalled();
  expect(render(settings).html).toBe("");
});

it("the card on an empty Cloud shows only when main suggests it, and says Mac on a Mac", async () => {
  await ready(suggestion);
  expect(render(suggestion).html).toBe("");
  await ready(suggestion, overview({ suggest: true }));
  const { html } = render(suggestion);
  expect(html).toContain("Bring your bots and chats from this Mac");
  expect(html).toContain("Your Cloud is empty. Move 4 bots and 37 chats here (about 1.5 GB).");
  expect(button(suggestion, "Move")).toBeTruthy();
  expect(button(suggestion, "Not now")).toBeTruthy();
});

it("the card moves on Move and keeps showing the move; Not now hides it for good", async () => {
  await ready(suggestion, overview({ suggest: true }));
  button(suggestion, "Move")!.props.onClick!(); await flush();
  expect(bridge.start).toHaveBeenCalledExactlyOnceWith();
  push({ phase: "uploading", action: "move", progress: { bytesTransferred: 1, totalBytes: 2 } });
  vi.mocked(bridge.state).mockResolvedValue(overview({ suggest: false, phase: "uploading" }));
  expect(render(suggestion).html).toContain("Uploading to your Cloud");

  f.values = []; f.effects = [];
  vi.stubGlobal("window", { ogb: { platform: "win32", cloudMove: bridge } });
  await ready(suggestion, overview({ suggest: true }));
  expect(render(suggestion).html).toContain("Bring your bots and chats from this computer");
  button(suggestion, "Not now")!.props.onClick!(); await flush();
  expect(bridge.dismiss).toHaveBeenCalledExactlyOnceWith();
  expect(render(suggestion).html).toBe("");
});
