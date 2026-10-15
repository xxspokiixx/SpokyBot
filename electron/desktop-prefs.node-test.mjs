import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createDesktopPrefs, DESKTOP_NOTICES, HANDOFF_MS, registerDesktopPrefs } from "./desktop-prefs.mjs";
import { localDay } from "./cloud-trial-notice.mjs";

const require = createRequire(import.meta.url);
const environments = require("./environments.cjs");
const localOrigin = require("./local-origin.cjs");

const POPUP = "cloud-pro-update-2026-10";
const HOUR = 3600_000, NOON = new Date(2026, 9, 16, 12).getTime();
const LOCAL = "http://127.0.0.1:18799", CLOUD = "https://omb-u-1.fly.dev", VPS = "https://bots.example.test";

test("the popup is the one notice a page can record; seen and analytics survive a restart; a broken record never stops the app", () => {
  assert.deepEqual([...DESKTOP_NOTICES], [POPUP]);
  let saved = null;
  const writes = [];
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { writes.push(value); saved = structuredClone(value); }, now: () => NOON });
  assert.deepEqual(prefs.seen(), []); assert.equal(prefs.analytics(), null);
  for (const id of ["other-notice", "__proto__", "", 42]) prefs.markSeen(id);
  assert.equal(writes.length, 0, "nothing a page names outside the list is written");
  prefs.markSeen(POPUP); prefs.markSeen(POPUP);
  assert.deepEqual(prefs.seen(), [POPUP]); assert.equal(writes.length, 1);
  prefs.setAnalytics(false);
  const restarted = createDesktopPrefs({ read: () => saved, write: value => { saved = value; }, now: () => NOON });
  assert.deepEqual(restarted.seen(), [POPUP]); assert.equal(restarted.analytics(), false);
  restarted.setAnalytics("yes"); assert.equal(restarted.analytics(), false, "only true turns it on");
  restarted.setAnalytics(true); assert.equal(restarted.analytics(), true);

  const broken = createDesktopPrefs({ read: () => { throw new Error("unreadable"); }, write: () => { throw new Error("read-only disk"); }, now: () => NOON });
  assert.deepEqual(broken.seen(), []);
  broken.markSeen(POPUP); broken.setAnalytics(false);
  assert.deepEqual(broken.seen(), [POPUP], "kept for this launch when the file cannot be written");
  assert.equal(broken.analytics(), false);
  for (const record of ["nonsense", [POPUP], { seen: "all", shown: [], analytics: "off" }, { seen: [POPUP, "<b>"], shown: { [POPUP]: "today" } }]) {
    const prefs = createDesktopPrefs({ read: () => record, write: () => {}, now: () => NOON });
    assert.equal(prefs.analytics(), null, JSON.stringify(record));
    assert.ok(prefs.seen().every(id => id === POPUP), JSON.stringify(record));
    if (!prefs.seen().length) assert.equal(prefs.shown(POPUP), true, JSON.stringify(record));
  }
});

test("shown counts once a day on this desktop, whichever page asks, until the popup is seen", () => {
  let now = NOON, saved = null;
  const prefs = createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); }, now: () => now });
  assert.equal(prefs.shown(POPUP), true);
  assert.equal(prefs.shown(POPUP), false, "a reload the same day");
  assert.equal(createDesktopPrefs({ read: () => saved, write: () => {}, now: () => now }).shown(POPUP), false, "another page, another launch, the same day");
  assert.equal(saved.shown[POPUP], localDay(NOON));
  now += 24 * HOUR;
  assert.equal(prefs.shown(POPUP), true, "the next day, still not seen");
  prefs.markSeen(POPUP); now += 24 * HOUR;
  assert.equal(prefs.shown(POPUP), false);
  assert.equal(prefs.shown("other-notice"), false);
});

function desktopMain({ offered = true, switches = true, page = event => event.page } = {}) {
  const handlers = new Map(), listeners = new Map(), calls = [];
  let saved = null, now = NOON;
  registerDesktopPrefs({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: (channel, listener) => listeners.set(channel, listener) },
    read: () => saved, write: value => { saved = structuredClone(value); }, page,
    cloudOffered: async () => { calls.push("offered"); return offered; },
    thisComputer: async () => { calls.push("this-computer"); return switches; },
    now: () => now,
  });
  const ask = (channel, page, ...args) => handlers.get(channel)({ page }, ...args);
  const read = page => { const event = { page }; listeners.get("desktop-analytics:read")(event); return event.returnValue; };
  return { ask, read, calls, saved: () => saved, later: ms => { now += ms; } };
}

test("every page of this desktop's window reads and records the same notices; nothing else is answered", async () => {
  const main = desktopMain();
  for (const page of ["local", "server"]) assert.deepEqual(await main.ask("desktop-notices:state", page), { seen: [], cloud: true });
  assert.equal(await main.ask("desktop-notices:shown", "server", POPUP), true);
  assert.equal(await main.ask("desktop-notices:shown", "local", POPUP), false, "once a day for the desktop, not per page");
  await main.ask("desktop-notices:seen", "server", POPUP);
  assert.deepEqual(await main.ask("desktop-notices:state", "local"), { seen: [POPUP], cloud: true });
  for (const channel of ["desktop-notices:state", "desktop-notices:seen", "desktop-notices:shown", "desktop-notices:this-computer", "desktop-notices:handoff", "desktop-analytics:set"]) {
    assert.throws(() => main.ask(channel, null, POPUP), /only available in this app's window/, channel);
  }
  assert.deepEqual((await desktopMain({ offered: false }).ask("desktop-notices:state", "server")).cloud, false);
});

test("a saved server's page switches the window once, for a popup not yet seen; This computer's page takes that click once, while fresh", async () => {
  const main = desktopMain();
  assert.throws(() => main.ask("desktop-notices:this-computer", "local"), /only available/, "This computer's page has nothing to switch to");
  assert.throws(() => main.ask("desktop-notices:handoff", "server"), /only available/, "a server's page never takes the click");
  assert.equal(await main.ask("desktop-notices:handoff", "local"), false, "nothing handed over");
  assert.equal(await main.ask("desktop-notices:this-computer", "server"), true);
  assert.deepEqual(main.calls.filter(call => call === "this-computer"), ["this-computer"]);
  assert.deepEqual(main.saved().seen, [POPUP], "seen before the switch");
  assert.equal(await main.ask("desktop-notices:handoff", "local"), true);
  assert.equal(await main.ask("desktop-notices:handoff", "local"), false, "once");
  assert.equal(await main.ask("desktop-notices:this-computer", "server"), false, "a seen popup switches nothing");
  assert.deepEqual(main.calls.filter(call => call === "this-computer"), ["this-computer"]);

  const late = desktopMain();
  await late.ask("desktop-notices:this-computer", "server"); late.later(HANDOFF_MS);
  assert.equal(await late.ask("desktop-notices:handoff", "local"), false, "a stale click is dropped");
  const stuck = desktopMain({ switches: false });
  assert.equal(await stuck.ask("desktop-notices:this-computer", "server"), false);
  assert.equal(await stuck.ask("desktop-notices:handoff", "local"), false, "nothing handed over when the window could not switch");
  const unsold = desktopMain({ offered: false });
  assert.equal(await unsold.ask("desktop-notices:this-computer", "server"), false);
  assert.equal(unsold.calls.includes("this-computer"), false);
});

test("the analytics switch is This computer's page's alone, read at once, whichever port it is served on", async () => {
  const main = desktopMain();
  assert.equal(main.read("local"), null);
  await main.ask("desktop-analytics:set", "local", false);
  assert.equal(main.read("local"), false);
  assert.equal(main.read("server"), null, "a server's page never reads it");
  assert.equal(main.read(null), null);
  assert.throws(() => main.ask("desktop-analytics:set", "server", true), /only available/);
  assert.equal(main.read("local"), false);
  await main.ask("desktop-analytics:set", "local", true);
  assert.equal(main.read("local"), true);
  const broken = desktopMain({ page: () => { throw new Error("Object has been destroyed"); } });
  assert.equal(broken.read("local"), null);
});

const PRELOAD = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
function preload(origin, { activation = false, saved = null } = {}) {
  let bridge;
  const invoked = [], synced = [];
  vm.runInNewContext(PRELOAD, {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`, "--omb-company-desktop=1"] },
    location: { origin }, navigator: { userActivation: { isActive: activation } }, TextEncoder, localStorage: { getItem: () => null },
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on() {}, removeListener() {}, send() {},
        sendSync: channel => { synced.push(channel); return channel === "desktop-analytics:read" ? saved : undefined; },
        invoke: (...args) => { invoked.push(args); return Promise.resolve(true); } } }),
  });
  return { bridge, invoked, synced };
}

test("the preload gives every page of the window the notices, and only This computer's page the analytics switch", async () => {
  for (const origin of [CLOUD, VPS]) {
    const page = preload(origin, { saved: false });
    assert.equal(typeof page.bridge.desktopNotices.state, "function", origin);
    assert.equal(page.bridge.desktopAnalytics, undefined, origin);
    assert.equal(page.bridge.cloudAccount, undefined, origin);
    assert.deepEqual(page.synced.filter(channel => channel.startsWith("desktop-")), [], "a server's page never asks for the switch");
    await page.bridge.desktopNotices.state(); await page.bridge.desktopNotices.seen({ toString: () => POPUP }); await page.bridge.desktopNotices.shown(POPUP);
    await page.bridge.desktopNotices.takeHandoff();
    assert.deepEqual(page.invoked, [["desktop-notices:state"], ["desktop-notices:seen", POPUP], ["desktop-notices:shown", POPUP], ["desktop-notices:handoff"]]);
    await assert.rejects(page.bridge.desktopNotices.thisComputer(), /Choose Continue on this computer/, "only on a click");
    const clicked = preload(origin, { activation: true });
    await clicked.bridge.desktopNotices.thisComputer();
    assert.deepEqual(clicked.invoked, [["desktop-notices:this-computer"]]);
  }
  const local = preload(LOCAL, { activation: true, saved: false });
  assert.equal(typeof local.bridge.desktopNotices.state, "function");
  await assert.rejects(local.bridge.desktopNotices.thisComputer(), /Choose Continue/, "This computer's page has nothing to switch to");
  assert.deepEqual(local.synced, [], "nothing is asked until analytics asks");
  assert.equal(local.bridge.desktopAnalytics.enabled(), false, "answered at once, before anything loads");
  assert.equal(local.bridge.desktopAnalytics.enabled(), false);
  assert.deepEqual(local.synced, ["desktop-analytics:read"], "asked once a page");
  await local.bridge.desktopAnalytics.set(true);
  assert.equal(local.bridge.desktopAnalytics.enabled(), true);
  assert.deepEqual(local.invoked, [["desktop-analytics:set", true]]);
  const unsaved = preload(LOCAL);
  for (let i = 0; i < 3; i++) assert.equal(unsaved.bridge.desktopAnalytics.enabled(), null);
  assert.deepEqual(unsaved.synced, ["desktop-analytics:read"], "no choice saved yet is asked once too");
  assert.equal(preload(LOCAL, { saved: "off" }).bridge.desktopAnalytics.enabled(), null);
  const safe = PRELOAD.match(/const REMOTE_SAFE = new Set\(\[([^\]]*)\]\)/)[1];
  assert.ok(safe.includes('"desktopNotices"')); assert.ok(!safe.includes("desktopAnalytics"));
});

test("production wiring: main answers this computer's page and the active saved server's own page, and no other", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = main.indexOf("  registerDesktopPrefs({"), end = main.indexOf("\n", main.indexOf("thisComputer:", start));
  assert.ok(start >= 0 && end > start, "main.mjs registers the desktop prefs");
  let options = null;
  const localFrame = { url: `${LOCAL}/` }, serverFrame = { url: `${VPS}/` };
  const contents = { mainFrame: serverFrame };
  const calls = [];
  localOrigin.setLocalOrigin(LOCAL);
  vm.runInNewContext(main.slice(start, end), {
    registerDesktopPrefs: value => { options = value; }, jsonFile: file => ({ read: () => file, write: () => {} }), ipcMain: {},
    path: { join: (...parts) => parts.join("/") }, app: { getPath: () => "/user-data" },
    senderIsLocal: localOrigin.isLocalSender, workspaceSenderAllowed: environments.workspaceSenderAllowed,
    mainWindow: { webContents: contents }, environmentsState: { environments: [{ id: "vps", name: "VPS", origin: VPS }], activeId: "vps" },
    rendererOrigin: () => LOCAL, cloudAccountRestored: async () => calls.push("restored"), cloudOffersReady: async () => { calls.push("offers"); return true; },
    serverReady: true, LOCAL_ID: "local", workspaceMenuAction: async action => action(), switchEnvironment: async id => calls.push(["switch", id]),
  });
  assert.equal(options.read(), "/user-data/desktop-prefs.json");
  assert.equal(options.page({ sender: { mainFrame: localFrame }, senderFrame: localFrame }), "local");
  assert.equal(options.page({ sender: contents, senderFrame: serverFrame }), "server");
  assert.equal(options.page({ sender: contents, senderFrame: { url: `${VPS}/` } }), null, "a frame inside the server's page");
  assert.equal(options.page({ sender: {}, senderFrame: serverFrame }), null, "another window");
  const evil = { url: "https://evil.example.test/" };
  assert.equal(options.page({ sender: { mainFrame: evil }, senderFrame: evil }), null, "a page that is not the active server");
  return Promise.all([options.cloudOffered(), options.thisComputer()]).then(([offered, switched]) => {
    assert.equal(offered, true); assert.equal(switched, true);
    assert.deepEqual(calls, ["restored", ["switch", "local"], "offers"]);
  });
});
