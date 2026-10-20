import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { existingFolders, grantSentence, installCloudLending, pageLending, usualFolderPaths, usualFolders } from "./cloud-lending-ipc.mjs";

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
    validate: async ([folder]) => { if (folder.path.includes("Gone")) throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }); return [folder]; },
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
  assert.deepEqual(calls, [["confirm", { folders: usual.map(({ name }) => ({ name, write: false })), screen: false }], ["save", { folders: usual, screen: false }]]);
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
  assert.deepEqual(again.calls, [["confirm", { folders: [{ name: "Plans", write: false }], screen: true }], ["save", { folders: plans, screen: true }]]);
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
    if (folder.path.endsWith("Missing")) throw Object.assign(new Error("no such file or directory"), { code: "ENOENT" });
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

test("the confirmation says exactly what goes: what bots may read, what they may also change, and the screen", () => {
  assert.equal(grantSentence({ folders: [{ name: "Desktop", write: false }, { name: "Documents", write: false }, { name: "Downloads", write: false }], screen: false }),
    "Bots on My Cloud can read Desktop, Documents and Downloads on this computer, without changing anything, in your own conversations and while this app is open. Turn it off at any time.");
  assert.equal(grantSentence({ folders: [{ name: "Plans", write: true }, { name: "Notes", write: false }], screen: true }),
    "Bots on My Cloud can read Notes, read and change files in Plans and see your screen and use your apps as you on this computer, in your own conversations and while this app is open. Turn it off at any time.");
});

test("only a folder that is gone is left out; any other refusal still fails the switch", async () => {
  const refuse = async ([folder]) => {
    if (folder.path === "/Users/me") throw new Error("Choose specific folders, not the entire computer or home folder");
    if (folder.path.endsWith("Gone")) throw Object.assign(new Error("gone"), { code: "ENOENT" });
    return [folder];
  };
  assert.deepEqual(await existingFolders([{ path: "/Users/me/Gone" }, { path: "/Users/me/Plans" }], refuse), [{ path: "/Users/me/Plans" }]);
  await assert.rejects(existingFolders([{ path: "/Users/me" }], refuse), /not the entire computer/);
});

test("a usual folder the system places at the home folder or a whole disk is looked for by its usual name instead, and else left out", async () => {
  // This platform's own paths, as main builds them: /home/me/Documents here, C:\home\me\Documents on Windows.
  const ROOT = path.parse(process.cwd()).root;
  const HOME = path.join(ROOT, "home", "me");
  const at = (name) => path.join(HOME, name);
  const exists = new Set([at("Desktop"), at("Documents")]);
  const validate = async ([folder]) => {
    if (folder.path === HOME || folder.path === ROOT) throw Object.assign(new Error("Choose specific folders, not the entire computer or home folder"), { code: "HOME_OR_ROOT" });
    if (!exists.has(folder.path)) throw Object.assign(new Error("no such file or directory"), { code: "ENOENT" });
    return [{ ...folder, name: path.basename(folder.path) }];
  };
  // Linux without user-dirs.dirs: Documents and Downloads are the home folder itself.
  const linux = await usualFolders(usualFolderPaths((name) => name === "desktop" ? at("Desktop") : HOME, HOME), validate);
  assert.deepEqual(linux.map((folder) => folder.path), [at("Desktop"), at("Documents")], "Documents by its usual name; no Downloads anywhere, so none");
  // A usual folder placed at a whole disk.
  const root = await usualFolders(usualFolderPaths((name) => name === "documents" ? ROOT : path.join(ROOT, "nowhere", name), HOME), validate);
  assert.deepEqual(root.map((folder) => folder.path), [at("Documents")]);
  // Both names the same folder: lent once.
  const twice = await usualFolders([{ path: HOME, named: at("Documents") }, { path: at("Documents"), named: at("Documents") }], validate);
  assert.deepEqual(twice.map((folder) => folder.path), [at("Documents")]);
  // The usual name is never tried for a folder that is merely gone, and a usual folder that is a file is left out.
  const tried = [], elsewhere = path.join(ROOT, "elsewhere", "Docs");
  await usualFolders([{ path: elsewhere, named: at("Documents") }], async ([folder]) => { tried.push(folder.path); throw Object.assign(new Error("gone"), { code: "ENOENT" }); });
  assert.deepEqual(tried, [elsewhere]);
  assert.deepEqual(await usualFolders([at("notes.txt")], async () => { throw Object.assign(new Error("Choose a folder, not a file"), { code: "NOT_FOLDER" }); }), []);
});

test("with the real folder checks and a home folder with Documents only, the usual folders are Documents, never the home folder", async () => {
  const { mkdtempSync, mkdirSync, realpathSync, rmSync } = await import("node:fs");
  const { homedir, tmpdir } = await import("node:os");
  const { validateSharedFolders } = await import("./computer-sharing.mjs");
  // The folder checks' own spelling (fsp.realpath is the native one): on Windows the long name, never 8.3 (RUNNER~1).
  const home = realpathSync.native(mkdtempSync(path.join(tmpdir(), "omb-lend-home-")));
  // The home folder the checks guard is os.homedir(): HOME on macOS and Linux, USERPROFILE on Windows.
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  try {
    mkdirSync(path.join(home, "Documents"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    assert.equal(realpathSync.native(homedir()), home, "the folder checks take this temporary folder for the home folder");
    const found = await usualFolders(usualFolderPaths((name) => name === "desktop" ? path.join(home, "Desktop") : home, home), validateSharedFolders);
    assert.deepEqual(found.map((folder) => [folder.path, folder.name, folder.write]), [[path.join(home, "Documents"), "Documents", false]]);
    await assert.rejects(validateSharedFolders([{ id: "8b0c8d3e-1f2a-4b5c-8d6e-7f8091a2b3c4", path: home, write: false }]), { code: "HOME_OR_ROOT" }, "a folder picked by hand still refuses the home folder");
  } finally {
    // Assigning undefined would set the text "undefined", so a variable that was unset is removed again.
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    rmSync(home, { recursive: true, force: true });
  }
});

test("nothing to lend, or a refused folder, is said plainly (no Try again); anything else is passed on as it was", async () => {
  const handlers = new Map(), calls = [];
  let fail = null, chosen = null;
  installCloudLending({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    localOnly: (_channel, handler) => handler, cloudPage: (_channel, handler) => handler,
    snapshot: async () => ({ available: true, screenAvailable: false, state: { enabled: false, folders: chosen ?? [], screen: false } }),
    environment: () => ({ id: "cloud" }),
    save: async (_env, choice) => { calls.push(["save", choice]); if (fail) throw fail; },
    stop: () => {}, confirm: async () => true,
    chooseFolder: async () => { throw Object.assign(new Error("Choose specific folders, not the entire computer or home folder"), { code: "HOME_OR_ROOT" }); },
    defaults: async () => [],
    validate: async ([folder]) => { throw Object.assign(new Error(`refused ${folder.path}`), { code: "NOT_FOLDER" }); },
  });
  await assert.rejects(handlers.get("cloud-lending:set")({ page: "cloud" }, true), { message: "lending-refused:nothing-to-lend" });
  await assert.rejects(handlers.get("lending:save")({ page: "local" }, { folders: [], screen: false }), { message: "lending-refused:nothing-to-lend" });
  assert.deepEqual(calls, [], "nothing to lend saves nothing");
  await assert.rejects(handlers.get("lending:folder")({ page: "local" }), { message: "lending-refused:home-or-root" });
  chosen = [{ id: "f", path: "/Users/me/notes.txt", name: "notes.txt", write: false }];
  await assert.rejects(handlers.get("cloud-lending:set")({ page: "cloud" }, true), { message: "lending-refused:not-folder" });
  fail = new Error("My Cloud didn't answer");
  await assert.rejects(handlers.get("lending:save")({ page: "local" }, { folders: [], screen: true }), { message: "My Cloud didn't answer" });
});
