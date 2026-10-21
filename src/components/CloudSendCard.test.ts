import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudSendBridge, CloudSendNotice, CloudSendPageBridge, CloudSendSnapshot } from "../../electron/cloud-send.mjs";
import { setLocale } from "@/lib/i18n";
const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = initial; return [f.values[index], (next: unknown) => { f.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(f.values[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = { current: initial }; return f.values[index]; },
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
}));
import { CloudSendCard } from "./CloudSendCard";
import { CloudSendStrip } from "./CloudSendStrip";

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean; "aria-label"?: string; "data-cloud-send-all"?: boolean }>;
function nodes(value: ReactNode): Node[] { if (!isValidElement(value)) return []; const node = value as Node; return [node, ...Children.toArray(node.props.children).flatMap(nodes)]; }
function render(component: () => ReactNode) {
  f.index = 0; f.effects = []; let tree: ReactNode;
  function Capture() { tree = component(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture)).replaceAll("&#x27;", "'");
  return { html, nodes: Children.toArray(nodes(tree)).flatMap((node) => [node as Node]) };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deep = (value: ReactNode): Node[] => {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  if (typeof node.type === "function") return deep((node.type as (props: unknown) => ReactNode)(node.props));
  return [node, ...Children.toArray(node.props.children).flatMap(deep)];
};
const tree = (component: () => ReactNode) => { f.index = 0; f.effects = []; return deep(component()); };
const text = (node: Node): string => Children.toArray(node.props.children).map((child) => isValidElement(child) ? text(child as Node) : String(child)).join("");

const snapshot: CloudSendSnapshot = {
  cloud: "ready", running: null, pending: 2, chats: { waiting: 12 }, signature: "sig", dismissed: "", last: null, whole: null, cloudVersion: "0.1.117", localVersion: "0.1.117",
  arrived: { bots: 0, updatedBots: 0, skills: 0, logins: 0, onePassword: false, settings: 0, chats: { conversations: 0, messages: 0 } },
  rows: [
    { key: "bot:ember", kind: "bot", label: "Ember", id: "ember", state: "only-here" },
    { key: "bot:juno", kind: "bot", label: "Juno", id: "juno", state: "differs", differs: ["title"] },
    { key: "1password", kind: "1password", label: "1Password", state: "only-here" },
  ],
  cloudOnly: [{ key: "bot:miso", kind: "bot", label: "Miso" }],
};
let bridge: CloudSendBridge;
beforeEach(() => {
  f.values = []; f.index = 0; f.effects = [];
  bridge = {
    state: vi.fn().mockResolvedValue(snapshot), refresh: vi.fn().mockResolvedValue(snapshot), onState: vi.fn(() => () => {}),
    send: vi.fn().mockResolvedValue({ at: 1, reason: "button", result: { bots: ["Ember"], updatedBots: [], skills: 0, logins: 0, onePassword: true, settings: [], chats: { conversations: 48, messages: 900 }, failed: [], notes: [] } }),
    setItem: vi.fn().mockResolvedValue(snapshot),
  };
  setLocale("en");
});
afterEach(() => { vi.unstubAllGlobals(); });

const card = () => CloudSendCard();
async function ready() {
  vi.stubGlobal("window", { ogb: { cloudSend: bridge } });
  render(card); for (const effect of f.effects) effect(); await flush();
}

const counts = { bots: 0, updatedBots: 0, skills: 0, logins: 0, onePassword: false, settings: 0, chats: null };

it("Settings → MausBot Cloud: online, what is not on My Cloud yet, and Send everything; no switch and no side-by-side", async () => {
  await ready();
  const { html } = render(card);
  expect(bridge.refresh).toHaveBeenCalledTimes(1);
  expect(html).toContain("This computer and My Cloud");
  expect(html).toContain("My Cloud is online · version 0.1.117");
  expect(html).toContain("Not on My Cloud yet: 1 bot, 1Password, and 12 chats.");
  expect(html).toContain("Stays separate: sign-ins to Claude");
  for (const gone of ["Keep My Cloud up to date", "role=\"switch\"", "More", "Ember only here", "Choose what goes", "Use this computer's"]) expect(html).not.toContain(gone);
  const sendAll = tree(card).find((node) => node.props["data-cloud-send-all"])!;
  expect(text(sendAll)).toBe("Send everything to My Cloud");
  sendAll.props.onClick!(); await flush();
  expect(bridge.send).toHaveBeenCalledWith();
  f.values = [];
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, pending: 0, chats: { waiting: 0 }, rows: [], last: { at: 1, reason: "button", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: { conversations: 0, messages: 3 }, failed: [], notes: [] } } });
  await ready();
  const done = render(card).html;
  expect(done).toContain("Everything from this computer is on My Cloud.");
  expect(done).toContain("Last sent:");
});

it("says it is sending, with progress, and what couldn't go with one Try again", async () => {
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, running: { reason: "move", progress: { done: 3, total: 12 }, phase: "chats" } });
  await ready();
  expect(render(card).html).toContain("Bringing chats to My Cloud… 3 of 12");
  expect(render(card).html).not.toContain("Try again");
  expect(tree(card).find((node) => node.props["data-cloud-send-all"])!.props.disabled, "one send at a time").toBe(true);
  f.values = [];
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, last: { at: 5, reason: "button", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, notes: [],
    failed: [{ key: "1password", kind: "1password", label: "1Password", error: "1Password did not accept this computer's token on My Cloud." }] } } });
  await ready();
  expect(render(card).html).toContain("1Password couldn't be sent: 1Password did not accept this computer's token on My Cloud.");
  const retries = tree(card).filter((node) => node.type === "button" && text(node) === "Try again");
  expect(retries).toHaveLength(1);
  retries[0]!.props.onClick!(); await flush();
  expect(bridge.send).toHaveBeenCalledWith();
});

it("is absent without My Cloud, in a browser and on a paired remote client", async () => {
  vi.mocked(bridge.state).mockResolvedValue({ ...snapshot, cloud: "none" });
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, cloud: "none" });
  await ready();
  expect(render(card).html).toBe("");
  vi.stubGlobal("window", {});
  f.values = [];
  expect(render(card).html).toBe("");
  vi.stubGlobal("window", { ogb: { cloudSend: bridge, remoteClient: { active: true } } });
  f.values = [];
  expect(render(card).html).toBe("");
});

const notice: CloudSendNotice = { ready: true, bots: ["Ember"], updatedBots: [], skills: 2, logins: 0, onePassword: true, settings: 0, signature: "sig-1", dismissed: false, running: false, last: null, whole: null };
let page: CloudSendPageBridge;
const strip = (cloudHome = true) => () => CloudSendStrip({ cloudHome });
async function onCloud(value: CloudSendNotice = notice, cloudHome = true) {
  page = { notice: vi.fn().mockResolvedValue(value), send: vi.fn().mockResolvedValue({ ...value, last: { at: 9, reason: "my-cloud", failed: 0, seen: false, sent: counts } }),
    dismiss: vi.fn().mockResolvedValue({ ...value, last: value.last && { ...value.last, seen: true } }), onNotice: vi.fn(() => () => {}) };
  vi.stubGlobal("window", { ogb: { cloudSendPage: page } });
  render(strip(cloudHome)); for (const effect of f.effects) effect(); await flush();
}

it("My Cloud's strip has nothing to press while all is well", async () => {
  await onCloud();
  const html = render(strip()).html;
  expect(html).toBe("");
  for (const gone of ["Bring them over", "Not now"]) expect(html).not.toContain(gone);
  f.values = [];
  await onCloud({ ...notice, last: { at: 2, reason: "button", failed: 0, seen: false, sent: { ...counts, chats: { conversations: 0, messages: 4 } } } });
  expect(render(strip()).html, "a send from this computer's Settings that went well says nothing here").toBe("");
});

it("the move: the strip shows it arriving with progress, then what came, until closed", async () => {
  await onCloud({ ...notice, running: true, runningReason: "move", progress: { done: 4, total: 12 } });
  expect(render(strip()).html).toContain("Bringing this computer's bots, logins and chats here… 4 of 12");
  expect(tree(strip()).some((node) => node.type === "button")).toBe(false);
  f.values = [];
  await onCloud({ ...notice, last: { at: 3, reason: "move", failed: 0, seen: false, sent: { ...counts, bots: 12, skills: 3, logins: 2, onePassword: true, chats: { conversations: 48, messages: 900 } } } });
  expect(render(strip()).html).toContain("12 bots, 3 skills, 2 logins, 1Password, and 48 chats came over from This computer.");
  tree(strip()).find((node) => node.type === "button" && text(node) === "Close")!.props.onClick!(); await flush();
  expect(page.dismiss).toHaveBeenCalledWith("result:3");
  expect(render(strip()).html).toBe("");
});

it("on this computer's page the strip shows only the one-time move's own line", async () => {
  await onCloud({ ...notice, running: true, runningReason: "move" }, false);
  expect(render(strip(false)).html, "a send's progress is My Cloud's to show").toBe("");
  f.values = [];
  await onCloud({ ...notice, move: { phase: "wait", waitingFor: "Scout" } }, false);
  expect(render(strip(false)).html).toContain("Moving your bots to My Cloud… waiting for Scout to finish");
  expect(tree(strip(false)).some((node) => node.type === "button"), "nothing to press while it goes").toBe(false);
  f.values = [];
  await onCloud({ ...notice, move: { phase: "copy", failing: { error: "My Cloud did not answer." } } }, false);
  page.moveRetry = vi.fn().mockResolvedValue({ ...notice, move: { phase: "finishing" } });
  tree(strip(false)).find((node) => node.type === "button" && text(node) === "Try again")!.props.onClick!(); await flush();
  expect(page.moveRetry).toHaveBeenCalledTimes(1);
  expect(page.send).not.toHaveBeenCalled();
});

it("My Cloud's page says once what arrived, with the phone to pair, until closed", async () => {
  const pair = vi.fn();
  await onCloud({ ...notice, move: { phase: "done", counts: { bots: 4, skills: 2, logins: 2, onePassword: true, chats: 148, routines: 2 }, phone: true, held: [] } });
  const shown = () => () => CloudSendStrip({ cloudHome: true, onPairPhone: pair });
  expect(render(shown()).html).toContain("Everything from this computer is here: 4 bots, 2 skills, 2 logins, 1Password, 148 chats, and 2 routines.");
  tree(shown()).find((node) => node.type === "button" && text(node) === "Pair your phone with My Cloud")!.props.onClick!();
  expect(pair).toHaveBeenCalledTimes(1);
  tree(shown()).find((node) => node.type === "button" && text(node) === "Close")!.props.onClick!(); await flush();
  expect(page.dismiss).toHaveBeenCalledWith("one-home");
});

it("My Cloud's strip says what could not be brought over and why, with one Try again", async () => {
  const failed: CloudSendNotice = { ...notice, last: { at: 3, reason: "move", failed: 3, seen: false, sent: counts,
    reasons: [{ what: { bots: [], skills: 0, logins: 2, onePassword: true, settings: 0, chats: false }, error: "OpenMausBot on this computer did not answer. Try again." }] } };
  await onCloud(failed);
  const html = render(strip()).html;
  expect(html).toContain("2 logins and 1Password couldn't be sent: OpenMausBot on this computer did not answer. Try again.");
  expect(html).not.toContain("See This computer's Settings");
  const retry = tree(strip()).filter((node) => node.type === "button" && text(node) === "Try again");
  expect(retry).toHaveLength(1);
  vi.mocked(page.send).mockResolvedValue({ ...failed, last: { at: 4, reason: "my-cloud", failed: 0, seen: false, sent: counts, error: "This app could not sign in to My Cloud. Try again." } });
  retry[0]!.props.onClick!(); await flush();
  expect(page.send).toHaveBeenCalledTimes(1);
  expect(render(strip()).html).toContain("Send to My Cloud stopped: This app could not sign in to My Cloud. Try again.");
  vi.mocked(page.send).mockRejectedValue(new Error("Error invoking remote method 'cloud-send:page-send': Error: cloud-send:page-send is only available in this app's window"));
  tree(strip()).find((node) => node.type === "button" && text(node) === "Try again")!.props.onClick!(); await flush();
  expect(render(strip()).html).toContain("Send to My Cloud stopped: cloud-send:page-send is only available in this app's window");
});

it("a refusal trying again can't fix is said plainly with no Try again, in Settings and on My Cloud's strip", async () => {
  const refused = { key: "1password", kind: "1password" as const, label: "1Password", final: true as const,
    error: "My Cloud's 1Password did not accept this computer's token: it may have been revoked, expired, or lost access to its vault. Connect 1Password again in this computer's Settings → Logins, and it goes to My Cloud by itself." };
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, last: { at: 6, reason: "button", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, notes: [], failed: [refused] } } });
  await ready();
  expect(render(card).html).toContain("1Password couldn't be sent: My Cloud's 1Password did not accept this computer's token");
  expect(tree(card).filter((node) => node.type === "button" && text(node) === "Try again")).toHaveLength(0);
  f.values = [];
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, last: { at: 7, reason: "button", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, notes: [],
    failed: [refused, { key: "login:a", kind: "login", label: "a.example", error: "OpenMausBot on this computer did not answer. Try again." }] } } });
  await ready();
  expect(tree(card).filter((node) => node.type === "button" && text(node) === "Try again"), "one failure trying again can fix: Try again is back").toHaveLength(1);
  const plain: CloudSendNotice = { ...notice, last: { at: 8, reason: "move", failed: 1, seen: false, sent: counts, final: true,
    reasons: [{ what: { bots: [], skills: 0, logins: 0, onePassword: true, settings: 0, chats: false }, error: refused.error }] } };
  await onCloud(plain);
  expect(render(strip()).html).toContain("1Password couldn't be sent: My Cloud's 1Password did not accept this computer's token");
  expect(tree(strip()).filter((node) => node.type === "button" && text(node) === "Try again")).toHaveLength(0);
  expect(tree(strip()).filter((node) => node.type === "button" && text(node) === "Close")).toHaveLength(1);
});

