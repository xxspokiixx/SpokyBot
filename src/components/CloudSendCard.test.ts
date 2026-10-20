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

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; "aria-checked"?: boolean; "aria-label"?: string; "data-cloud-send-all"?: boolean; "data-cloud-send-more"?: boolean }>;
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
  cloud: "ready", auto: true, running: null, pending: 2, signature: "sig", dismissed: "", last: null, cloudVersion: "0.1.117", localVersion: "0.1.117",
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
    setAuto: vi.fn().mockResolvedValue({ ...snapshot, auto: false }), setItem: vi.fn().mockResolvedValue(snapshot),
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

it("Settings → MausBot Cloud: online, one line on where things stand, and the switch, on by default; no buttons to send", async () => {
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, pending: 0, last: { at: 1, reason: "auto", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: { conversations: 0, messages: 3 }, failed: [], notes: [] } } });
  await ready();
  const { html } = render(card);
  expect(bridge.refresh).toHaveBeenCalledTimes(1);
  expect(html).toContain("This computer and My Cloud");
  expect(html).toContain("My Cloud is online · version 0.1.117");
  expect(html).toContain("Everything from this computer is on My Cloud.");
  expect(html).toContain("Keep My Cloud up to date with this computer");
  expect(html).toContain('aria-labelledby="cloud-send-auto" data-cloud-send-auto="true" type="button" role="switch" aria-checked="true"');
  expect(html).toContain("Stays separate: sign-ins to Claude");
  for (const gone of ["Send everything to My Cloud", "Choose what goes", "Use this computer's", "Also on My Cloud", "Bring them over", "Ember only here"]) expect(html).not.toContain(gone);
  tree(card).find((node) => node.props["aria-checked"] === true)!.props.onClick!(); await flush();
  expect(bridge.setAuto).toHaveBeenCalledWith(false);
});

it("says it is sending, with progress, and what couldn't go with one Try again", async () => {
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, running: { reason: "first", progress: { done: 3, total: 12 }, phase: "chats" } });
  await ready();
  expect(render(card).html).toContain("Bringing chats to My Cloud… 3 of 12");
  expect(render(card).html).not.toContain("Try again");
  f.values = [];
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, last: { at: 5, reason: "auto", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, notes: [],
    failed: [{ key: "1password", kind: "1password", label: "1Password", error: "1Password did not accept this computer's token on My Cloud." }] } } });
  await ready();
  expect(render(card).html).toContain("1Password couldn't be sent: 1Password did not accept this computer's token on My Cloud.");
  const retries = tree(card).filter((node) => node.type === "button" && text(node) === "Try again");
  expect(retries).toHaveLength(1);
  retries[0]!.props.onClick!(); await flush();
  expect(bridge.send).toHaveBeenCalledWith();
});

it("keeps the comparison and a manual send under More, and says so when Keep My Cloud up to date is off", async () => {
  vi.mocked(bridge.refresh).mockResolvedValue({ ...snapshot, auto: false });
  await ready();
  expect(render(card).html).toContain("Keep My Cloud up to date is off: what you add on this computer stays here.");
  tree(card).find((node) => node.props["data-cloud-send-more"])!.props.onClick!();
  const html = render(card).html;
  expect(html).toContain("Ember only here · 1 different on My Cloud · Miso only on My Cloud");
  expect(html).toContain("Send everything to My Cloud");
  tree(card).find((node) => node.props["data-cloud-send-all"])!.props.onClick!(); await flush();
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

const notice: CloudSendNotice = { ready: true, auto: true, bots: ["Ember"], updatedBots: [], skills: 2, logins: 0, onePassword: true, settings: 0, signature: "sig-1", dismissed: false, running: false, last: null };
let page: CloudSendPageBridge;
const strip = (cloudHome = true) => () => CloudSendStrip({ cloudHome });
async function onCloud(value: CloudSendNotice = notice, cloudHome = true) {
  page = { notice: vi.fn().mockResolvedValue(value), send: vi.fn().mockResolvedValue({ ...value, last: { at: 9, reason: "my-cloud", failed: 0, seen: false, sent: counts } }),
    dismiss: vi.fn().mockResolvedValue({ ...value, last: value.last && { ...value.last, seen: true } }), onNotice: vi.fn(() => () => {}) };
  vi.stubGlobal("window", { ogb: { cloudSendPage: page } });
  render(strip(cloudHome)); for (const effect of f.effects) effect(); await flush();
}

it("My Cloud's strip has nothing to press while all is well: what waits goes by itself", async () => {
  await onCloud();
  const html = render(strip()).html;
  expect(html).toBe("");
  for (const gone of ["Bring them over", "Not now"]) expect(html).not.toContain(gone);
  f.values = [];
  await onCloud({ ...notice, last: { at: 2, reason: "auto", failed: 0, seen: false, sent: { ...counts, chats: { conversations: 0, messages: 4 } } } });
  expect(render(strip()).html, "a background send that went well says nothing").toBe("");
});

it("the first send, by itself: the strip shows it arriving with progress, then what came, until closed", async () => {
  await onCloud({ ...notice, running: true, runningReason: "first", progress: { done: 4, total: 12 } });
  expect(render(strip()).html).toContain("Bringing this computer's bots, logins and chats here… 4 of 12");
  expect(tree(strip()).some((node) => node.type === "button")).toBe(false);
  f.values = [];
  await onCloud({ ...notice, last: { at: 3, reason: "first", failed: 0, seen: false, sent: { ...counts, bots: 12, skills: 3, logins: 2, onePassword: true, chats: { conversations: 48, messages: 900 } } } });
  expect(render(strip()).html).toContain("12 bots, 3 skills, 2 logins, 1Password, and 48 chats came over from This computer.");
  tree(strip()).find((node) => node.type === "button" && text(node) === "Close")!.props.onClick!(); await flush();
  expect(page.dismiss).toHaveBeenCalledWith("result:3");
  expect(render(strip()).html).toBe("");
});

it("the strip stays away on any page but My Cloud's", async () => {
  await onCloud({ ...notice, running: true, runningReason: "first" }, false);
  expect(render(strip(false)).html).toBe("");
  expect(page.notice).not.toHaveBeenCalled();
});

it("My Cloud's strip says what could not be brought over and why, with one Try again", async () => {
  const failed: CloudSendNotice = { ...notice, last: { at: 3, reason: "auto", failed: 3, seen: false, sent: counts,
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
