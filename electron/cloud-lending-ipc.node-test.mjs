import assert from "node:assert/strict";
import test from "node:test";

import { installCloudLending, pageLending, usualFolders } from "./cloud-lending-ipc.mjs";

const usual = ["Desktop", "Documents", "Downloads"].map((name, i) => ({ id: `id-${i}`, path: `/Users/me/${name}`, name, write: false }));

function setup({ enabled = false, kept = { folders: [], screen: false }, confirmed = true, screenAvailable = true } = {}) {
  const handlers = new Map(), calls = [];
  let state = { enabled, folders: kept.folders, screen: kept.screen, busy: false, connected: enabled };
  installCloudLending({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    localOnly: (channel, handler) => (event, ...args) => { if (event.page !== "local") throw new Error(`${channel} is only available in this app's window`); return handler(event, ...args); },
    cloudPage: (channel, handler) => (event, ...args) => { if (!event.page) throw new Error(`${channel} is only available in this app's window`); return handler(event, ...args); },
    snapshot: async () => ({ available: true, screenAvailable, state }),
    environment: () => ({ id: "cloud" }),
    save: async (_env, choice) => { calls.push(["save", choice]); state = { ...state, enabled: true, connected: true, folders: choice.folders, screen: choice.screen }; },
    stop: () => { calls.push(["stop"]); state = { ...state, enabled: false, connected: false }; },
    chooseFolder: async () => null,
    defaults: async () => usual,
    validate: async ([folder]) => { if (folder.path.includes("Gone")) throw new Error("ENOENT"); return [folder]; },
    confirm: async (folders) => { calls.push(["confirm", folders]); return confirmed; },
  });
  return { handlers, calls };
}

test("turned on with nothing chosen, lending lends the usual folders, read only; a choice already made is kept", async () => {
  const fresh = setup();
  await fresh.handlers.get("lending:save")({ page: "local" }, { folders: [], screen: false });
  assert.deepEqual(fresh.calls, [["save", { folders: usual, screen: false }]]);
  const chosen = setup();
  const plans = [{ id: "p", path: "/Users/me/Plans", name: "Plans", write: true }];
  await chosen.handlers.get("lending:save")({ page: "local" }, { folders: plans, screen: true });
  assert.deepEqual(chosen.calls, [["save", { folders: plans, screen: true }]]);
});

test("My Cloud's page turns lending on in place, after a native confirmation naming what goes, and off at once", async () => {
  const { handlers, calls } = setup();
  const on = await handlers.get("cloud-lending:set")({ page: "cloud" }, true);
  assert.deepEqual(calls, [["confirm", ["Desktop", "Documents", "Downloads"]], ["save", { folders: usual, screen: false }]]);
  assert.deepEqual(on, { available: true, on: true, status: "lent", folders: usual.map(({ name, write }) => ({ name, write })), screen: false });
  assert.ok(!JSON.stringify(on).includes("/Users/me"), "the page never learns a path");
  const off = await handlers.get("cloud-lending:set")({ page: "cloud" }, false);
  assert.equal(off.on, false);
  assert.deepEqual(calls.at(-1), ["stop"]);
});

test("a confirmation the person declines lends nothing; an off switch lends again what it lent before", async () => {
  const declined = setup({ confirmed: false });
  assert.equal((await declined.handlers.get("cloud-lending:set")({ page: "cloud" }, true)).on, false);
  assert.deepEqual(declined.calls.map(([kind]) => kind), ["confirm"]);
  const plans = [{ id: "p", path: "/Users/me/Plans", name: "Plans", write: false }];
  const again = setup({ kept: { folders: plans, screen: true } });
  await again.handlers.get("cloud-lending:set")({ page: "cloud" }, true);
  assert.deepEqual(again.calls, [["confirm", ["Plans"]], ["save", { folders: plans, screen: true }]]);
  const noScreen = setup({ kept: { folders: plans, screen: true }, screenAvailable: false });
  await noScreen.handlers.get("cloud-lending:set")({ page: "cloud" }, true);
  assert.deepEqual(noScreen.calls.at(-1), ["save", { folders: plans, screen: false }]);
});

test("only this computer's own Settings chooses folders; any other page gets nothing", async () => {
  const { handlers } = setup();
  for (const channel of ["lending:state", "lending:folder", "lending:save", "lending:stop"]) assert.throws(() => handlers.get(channel)({ page: "cloud" }), /only available/, channel);
  for (const channel of ["cloud-lending:state", "cloud-lending:set"]) assert.throws(() => handlers.get(channel)({ page: null }), /only available/, channel);
});

test("the usual folders: each one that exists and passes the folder checks, the rest left out", async () => {
  const found = await usualFolders(["/a/Desktop", "/a/Missing", "/a/Documents"], async ([folder]) => {
    if (folder.path.endsWith("Missing")) throw new Error("ENOENT");
    return [{ ...folder, name: folder.path.split("/").pop() }];
  });
  assert.deepEqual(found.map((folder) => [folder.name, folder.write]), [["Desktop", false], ["Documents", false]]);
  assert.deepEqual(pageLending({ available: true, state: { enabled: false, folders: usual, problem: "signed-out" } }), { available: true, on: false, status: "signed-out", folders: [], screen: false });
});

test("a folder lent before and gone since is left out instead of failing the switch; with none left, the usual folders go", async () => {
  const gone = [{ id: "g", path: "/Users/me/Gone", name: "Gone", write: false }];
  const onlyGone = setup({ kept: { folders: gone, screen: false } });
  await onlyGone.handlers.get("cloud-lending:set")({ page: "cloud" }, true);
  assert.deepEqual(onlyGone.calls.at(-1), ["save", { folders: usual, screen: false }]);
  const plans = { id: "p", path: "/Users/me/Plans", name: "Plans", write: false };
  const mixed = setup();
  await mixed.handlers.get("lending:save")({ page: "local" }, { folders: [...gone, plans], screen: false });
  assert.deepEqual(mixed.calls, [["save", { folders: [plans], screen: false }]]);
});
