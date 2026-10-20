import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { BOT_PARTS, differenceSignature, itemKey, parseSendSummary, pendingRows, planSend } from "./cloud-send-parts.mjs";
import { botPatch, createCloudSend, parseSendState, sendNotice } from "./cloud-send.mjs";
import { installCloudSend, loginsView, openOwnerSession } from "./cloud-send-main.mjs";

const LOCAL = "http://127.0.0.1:4100";
const CLOUD = "https://omb-u-1.fly.dev";
const summary = (items) => ({ v: 1, appVersion: "0.1.117", items });
const bot = (id, parts, extra = {}) => ({ key: itemKey.bot(id), kind: "bot", label: id, id, parts, ...extra });

test("a part goes when it changed here and not there; My Cloud's own change is kept; what was removed there stays removed", () => {
  const here = summary([
    bot("ember", { soul: "s2", title: "t2", name: "n1" }),
    bot("juno", { soul: "j1" }),
    { key: itemKey.login("example.test", "alice"), kind: "login", label: "example.test", id: "l1", parts: { saved: "a1" } },
    { key: itemKey.setting("profile"), kind: "setting", label: "profile", parts: { name: "amit", about: "-" } },
  ]);
  const there = summary([
    bot("ember", { soul: "s1", title: "t9", name: "n1" }),
    { key: itemKey.setting("profile"), kind: "setting", label: "profile", parts: { name: "-", about: "-" } },
    bot("miso", { soul: "m1" }),
  ]);
  const sent = { [itemKey.bot("ember")]: { soul: ["s1", "s1"], title: ["t1", "t1"] }, [itemKey.login("example.test", "alice")]: { saved: ["a1", "c1"] } };
  const plan = planSend({ local: here, cloud: there, sent });
  const by = Object.fromEntries(plan.rows.map((row) => [row.key, row]));
  assert.deepEqual([by["bot:ember"].state, by["bot:ember"].parts, by["bot:ember"].differs], ["to-update", ["soul"], ["title"]]);
  assert.equal(by["bot:juno"].state, "only-here");
  assert.equal(by[itemKey.login("example.test", "alice")].state, "removed");
  assert.deepEqual(plan.removed, [itemKey.login("example.test", "alice")]);
  // My Cloud has no value: this computer's fills it; an equal part is remembered as in step.
  assert.deepEqual(by["setting:profile"].parts, ["name"]);
  assert.deepEqual(plan.baseline["bot:ember"], { name: ["n1", "n1"] });
  assert.deepEqual(plan.cloudOnly.map((row) => row.key), ["bot:miso"]);
  // The person chooses this computer's: the differing part goes too.
  assert.deepEqual(planSend({ local: here, cloud: there, sent, force: ["bot:ember"] }).rows.find((row) => row.key === "bot:ember").parts, ["soul", "title"]);
  // A login both sides have, never sent from here: in step from now on (its secret can't be compared).
  const logins = planSend({ local: summary([{ key: "login:a.test|amit", kind: "login", label: "a.test", parts: { saved: "1" } }]),
    cloud: summary([{ key: "login:a.test|amit", kind: "login", label: "a.test", parts: { saved: "9" } }]) });
  assert.deepEqual([logins.rows[0].state, logins.baseline["login:a.test|amit"]], ["on-both", { saved: ["1", "9"] }]);
  // Unchanged here, changed there: nothing goes.
  const quiet = planSend({ local: summary([bot("ember", { soul: "s1" })]), cloud: summary([bot("ember", { soul: "s5" })]), sent: { "bot:ember": { soul: ["s1", "s1"] } } });
  assert.equal(quiet.rows[0].state, "on-both");
});

test("a bot's skills go with the bot, follow its switch, and a removed bot's skills read as removed", () => {
  const skill = { key: itemKey.skill("ember", "notes"), kind: "skill", label: "notes", id: "notes", bot: "ember", parts: { text: "x", on: "on" } };
  const here = summary([bot("ember", { soul: "s" }), skill]);
  const plan = planSend({ local: here, cloud: summary([]) });
  assert.deepEqual(plan.rows.map((row) => row.state), ["only-here", "only-here"]);
  assert.deepEqual(pendingRows(plan).map((row) => row.key), ["bot:ember"]);
  assert.deepEqual(planSend({ local: here, cloud: summary([]), off: { "bot:ember": "you" } }).rows.map((row) => row.state), ["off", "off"]);
  assert.deepEqual(planSend({ local: here, cloud: summary([]), off: { "bot:ember": "removed" } }).rows.map((row) => row.state), ["removed", "removed"]);
  assert.equal(differenceSignature(plan), "bot:ember#only-here#");
});

test("a server's answer is kept only in the shape main relies on", () => {
  const parsed = parseSendSummary({ v: 1, appVersion: "0.1.117", items: [
    { key: "bot:ember", kind: "bot", label: "Ember", id: "ember", parts: { soul: "abc", "../x": "y", look: 5 } },
    { key: "evil", kind: "bot", parts: {} },
    { key: "bot:x", kind: "spaceship", parts: {} },
  ] });
  assert.deepEqual(parsed.items, [{ key: "bot:ember", kind: "bot", label: "Ember", id: "ember", parts: { soul: "abc" } }]);
  assert.equal(parseSendSummary({ v: 2, items: [] }), null);
  assert.equal(parseSendSummary(null), null);
});

test("a bot's fields reach My Cloud without Custom approval and without naming bots My Cloud lacks", () => {
  const ember = { id: "ember", soul: "Be brief.", approvalMode: "custom", alwaysAllow: ["Bash(ls)"], peers: ["juno", "kit"], modelSelection: { instanceId: "claude", model: "m", extra: 1 }, cwd: "/Users/amit/work" };
  const body = botPatch(ember, ["soul", "access", "team", "model"], new Set(["juno"]));
  assert.deepEqual(body, { soul: "Be brief.", alwaysAllow: ["Bash(ls)"], peers: ["juno"], modelSelection: { instanceId: "claude", model: "m" }, requireAvailableModel: true });
  assert.ok(!Object.values(BOT_PARTS).flat().includes("cwd"), "a working folder is this computer's");
  assert.deepEqual(parseSendState({ auto: false, clouds: { "javascript:alert(1)": {}, [CLOUD]: { off: { a: "you", b: "nonsense" } } } }).clouds,
    { [CLOUD]: { sent: {}, off: { a: "you" }, dismissed: "", last: null, whole: null, arrived: { bots: 0, updatedBots: 0, skills: 0, logins: 0, settings: 0, onePassword: false, chats: { conversations: 0, messages: 0 } }, chats: {} } });
  assert.equal(parseSendState(null).auto, true, "Keep My Cloud up to date is on unless the person turned it off");
});

function fakeSides({ cloudItems = [], localItems = [], refuse = {} } = {}) {
  const calls = [];
  const reply = (status, body) => ({ status, ok: status < 400, body });
  const session = {
    call: async (method, route) => {
      calls.push(`${method} ${route}`);
      if (route === "/api/cloud-send") return reply(200, summary(cloudItems));
      if (refuse[route]) return reply(refuse[route].status, { error: refuse[route].error });
      return reply(200, {});
    },
    upload: async (route) => { calls.push(`UPLOAD ${route}`); return reply(201, { path: "/data/attachments/abc.png" }); },
    close: async () => { calls.push("logout"); },
  };
  const localJson = (value) => new Response(JSON.stringify(value), { status: 200 });
  return {
    calls,
    deps: {
      local: async (route) => {
        if (route === "/api/cloud-send") return localJson(summary(localItems));
        if (route === "/api/bots?messages=0") return localJson({ bots: [{ id: "ember", threadId: "t-ember", name: "Ember", soul: "Be brief." }] });
        if (route === "/api/bots/ember/skills") return localJson({ skills: [] });
        if (route === "/api/bots/ember/memory") return localJson({ topics: [] });
        if (route.startsWith("/api/bots/ember/memory/file")) return localJson({ exists: false, text: "" });
        if (route === "/api/config") return localJson({ profile: { name: "Amit" } });
        return new Response("{}", { status: 404 });
      },
      cloud: { origin: () => CLOUD, asleep: () => false, read: async () => localJson(summary(cloudItems)), open: async () => session },
      handoff: async () => ({}),
      store: { read: () => null, write() {} },
      setTimer: () => 0, clearTimer() {},
    },
  };
}

test("a send adds a bot with its own id over one session, says what My Cloud refused, and always signs out", async () => {
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })], refuse: { "/api/bots": { status: 409, error: "this workspace is limited to 50 bots" } } });
  const send = createCloudSend(sides.deps);
  const outcome = await send.send();
  assert.deepEqual(outcome.result.failed, [{ key: "bot:ember", kind: "bot", label: "ember", error: "this workspace is limited to 50 bots" }]);
  assert.deepEqual(sides.calls, ["GET /api/cloud-send", "POST /api/bots", "GET /api/cloud-send", "logout"]);
  assert.equal(send.snapshot().last.result.failed.length, 1);

  const asleep = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  asleep.deps.cloud.asleep = () => true;
  assert.equal((await createCloudSend(asleep.deps).compare()).cloud, "asleep");
  assert.deepEqual(asleep.calls, [], "a sleeping Cloud is never asked");

  const outdated = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  outdated.deps.cloud.read = async () => new Response("", { status: 404 });
  assert.equal((await createCloudSend(outdated.deps).compare()).cloud, "outdated");
});

test("My Cloud's page is told names of bots and counts, with an opaque signature; Logins reads My Cloud's logins from the same comparison", async () => {
  const sides = fakeSides({
    localItems: [bot("ember", { soul: "s" }), { key: itemKey.login("bank.example", "amit"), kind: "login", label: "bank.example", id: "l1", parts: { saved: "1" } }],
    cloudItems: [{ key: itemKey.login("crm.example", "ops"), kind: "login", label: "crm.example", detail: "ops", parts: { saved: "2" } }, { key: "1password", kind: "1password", label: "1Password", parts: { token: "x" } }],
  });
  const snapshot = await createCloudSend(sides.deps).compare();
  const notice = sendNotice(snapshot);
  assert.deepEqual({ ...notice, signature: notice.signature.length }, { ready: true, auto: true, bots: ["ember"], updatedBots: [], skills: 0, logins: 1, onePassword: false, settings: 0, signature: 32, dismissed: false, running: false, last: null,
    whole: null, arrived: { bots: 0, updatedBots: 0, skills: 0, logins: 0, settings: 0, onePassword: false, chats: { conversations: 0, messages: 0 } } });
  assert.equal(sendNotice({ ...snapshot, auto: false }).auto, false, "with Keep My Cloud up to date off, My Cloud's welcome still offers its choice");
  assert.ok(!JSON.stringify(notice).includes("bank.example"));
  assert.deepEqual(loginsView(snapshot), { cloud: { reachable: true, logins: [{ site: "crm.example", username: "ops" }], onePassword: { connected: true, vaults: [] } } });
  assert.deepEqual(loginsView({ ...snapshot, cloud: "unreachable" }), { cloud: { reachable: false } });
  assert.deepEqual(loginsView({ ...snapshot, cloud: "none" }), { cloud: null });
});

test("an owner session is made only at the person's own Cloud, and nothing is sent to an origin a grant names instead", async () => {
  const fetched = [];
  const fetchImpl = async (url, init) => { fetched.push([url, init?.headers?.authorization ?? null]); return new Response(JSON.stringify({ token: "omb_sess_fake" }), { status: 200 }); };
  await assert.rejects(openOwnerSession({ origin: CLOUD, grant: async () => ({ origin: "https://attacker.example", code: "C" }) }, fetchImpl), /not ready/);
  assert.deepEqual(fetched, []);
  const session = await openOwnerSession({ origin: CLOUD, grant: async () => ({ origin: CLOUD, code: "C" }) }, fetchImpl);
  await session.call("GET", "/api/cloud-send");
  await session.close();
  assert.deepEqual(fetched.map(([url, auth]) => [url.replace(CLOUD, ""), auth]), [["/api/auth/pair", null], ["/api/cloud-send", "Bearer omb_sess_fake"], ["/api/auth/logout", "Bearer omb_sess_fake"]]);
});

test("this computer's Settings asks for everything; My Cloud's page only for its notice, Bring them over and Not now", async () => {
  const handlers = new Map();
  installCloudSend({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    localOnly: (channel, handler) => (event, ...args) => { if (event.page !== "local") throw new Error(`${channel} is only available in this app's window`); return handler(event, ...args); },
    cloudPage: (event) => event.page ?? null,
    server: () => null, local: async () => new Response("{}", { status: 503 }), home: () => null,
    cookieFetch: async () => new Response("", { status: 401 }), reconnect: async () => false, power: { asleep: () => false },
    file: () => "/nonexistent/cloud-send.json", window: () => null, localOrigin: () => LOCAL, openSettings() {},
  });
  const cloudPage = { page: "cloud" }, elsewhere = { page: null };
  for (const channel of ["cloud-send:state", "cloud-send:refresh", "cloud-send:send", "cloud-send:auto", "cloud-send:item", "cloud-logins:state", "cloud-logins:send"]) {
    assert.throws(() => handlers.get(channel)(cloudPage), /only available/, channel);
  }
  for (const channel of ["cloud-send:notice", "cloud-send:page-send", "cloud-send:dismiss"]) assert.throws(() => handlers.get(channel)(elsewhere), /only available/, channel);
  assert.deepEqual(await handlers.get("cloud-send:notice")(cloudPage), { ready: false, auto: true, bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: 0, signature: "", dismissed: false, running: false, last: null,
    whole: null, arrived: { bots: 0, updatedBots: 0, skills: 0, logins: 0, settings: 0, onePassword: false, chats: { conversations: 0, messages: 0 } } });
  assert.deepEqual(await handlers.get("cloud-logins:state")({ page: "local" }), { cloud: null });
  await assert.rejects(handlers.get("cloud-logins:send")({ page: "local" }, { kind: "1password" }), /no My Cloud yet/);
});

function preload({ remote = false, activation = false } = {}) {
  let bridge; const invoked = [];
  vm.runInNewContext(readFileSync(new URL("./preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`, "--omb-company-desktop=1"] },
    location: { origin: remote ? CLOUD : LOCAL }, navigator: { userActivation: { isActive: activation } },
    TextEncoder, localStorage: { getItem: () => null },
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on() {}, removeListener() {}, send() {}, sendSync: () => false, invoke: (...args) => { invoked.push(args); return Promise.resolve({}); } } }),
  });
  return { bridge, invoked };
}

test("the bridge: Settings → MausBot Cloud only on this computer's page; My Cloud's page sends only from the person's click", async () => {
  const local = preload();
  await local.bridge.cloudSend.send({ keys: ["bot:ember"], force: [7], origin: "https://evil.example" });
  await local.bridge.cloudSend.setItem("bot:ember", "yes");
  assert.deepEqual(JSON.parse(JSON.stringify(local.invoked)), [["cloud-send:send", { keys: ["bot:ember"], force: ["7"] }], ["cloud-send:item", "bot:ember", false]]);
  const page = preload({ remote: true });
  assert.equal(page.bridge.cloudSend, undefined);
  assert.equal(page.bridge.cloudLogins, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(page.bridge.cloudSendPage))), ["notice", "send", "dismiss", "onNotice"]);
  await assert.rejects(page.bridge.cloudSendPage.send(), /Bring them over/);
  assert.deepEqual(page.invoked.filter(([channel]) => channel.startsWith("cloud-send")), []);
  const clicked = preload({ remote: true, activation: true });
  await clicked.bridge.cloudSendPage.send();
  assert.deepEqual(JSON.parse(JSON.stringify(clicked.invoked.filter(([channel]) => channel.startsWith("cloud-send")))), [["cloud-send:page-send"]]);
});

test("Keep My Cloud up to date: the first time it sends everything by itself, then asks My Cloud only when something here changed, never while it sleeps or when switched off", async () => {
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  let fire = null;
  let now = 1_000;
  let asleep = false;
  const reads = [];
  sides.deps.cloud.asleep = () => asleep;
  const read = sides.deps.cloud.read;
  sides.deps.cloud.read = async (route) => { reads.push(route); return read(route); };
  const send = createCloudSend({ ...sides.deps, now: () => now, setTimer: (callback) => { fire = callback; return 1; }, clearTimer() {} });
  const tick = async () => { const run = fire; fire = null; run(); for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve)); };
  send.start();
  await tick();
  assert.deepEqual(reads, ["/api/cloud-send"]);
  assert.ok(sides.calls.includes("POST /api/bots"), "what waited went by itself");
  assert.equal(send.snapshot().last.reason, "first", "the first send to this Cloud, with no click");
  const calls = sides.calls.length;
  reads.length = 0;
  await tick();
  assert.deepEqual(reads, [], "nothing changed here, so My Cloud is not asked");
  now += 31 * 60_000;
  asleep = true;
  await tick();
  assert.deepEqual(reads, [], "a sleeping Cloud is never woken");
  asleep = false;
  send.setAuto(false);
  await tick();
  assert.deepEqual(reads, []);
  assert.equal(sides.calls.length, calls);
  assert.equal(send.snapshot().auto, false);
});

test("Also use on My Cloud says plainly when My Cloud is too old to receive a login, instead of losing the login", async () => {
  const handlers = new Map();
  installCloudSend({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    localOnly: (_channel, handler) => handler, cloudPage: () => "local",
    server: () => null, local: async () => new Response(JSON.stringify(summary([{ key: "1password", kind: "1password", label: "1Password", parts: { token: "t" } }])), { status: 200 }),
    home: () => ({ origin: CLOUD, grant: async () => ({ origin: CLOUD, code: "C" }) }),
    cookieFetch: async () => new Response("", { status: 404 }), reconnect: async () => false, power: { asleep: () => false },
    file: () => "/nonexistent/cloud-send.json", window: () => null, localOrigin: () => LOCAL, openSettings() {}, keepUpToDate: false,
  });
  assert.deepEqual(await handlers.get("cloud-logins:state")({}), { cloud: { reachable: false } });
  await assert.rejects(handlers.get("cloud-logins:send")({}, { kind: "1password" }), /My Cloud needs an update/);
});

test("replacing a skill whose text changed here puts My Cloud's copy back when the new one is refused", async () => {
  const skill = { key: itemKey.skill("ember", "notes"), kind: "skill", label: "notes", id: "notes", bot: "ember", parts: { text: "new", on: "on" } };
  const calls = [];
  const reply = (status, body) => ({ status, ok: status < 400, body });
  let installs = 0;
  const session = {
    call: async (method, route, body) => {
      calls.push(`${method} ${route}${body?.text ? ` ${body.text}` : ""}`);
      if (route === "/api/cloud-send") return reply(200, summary([bot("ember", { soul: "s" }), { ...skill, parts: { text: "old", on: "on" } }]));
      if (method === "GET" && route === "/api/bots/ember/skills") return reply(200, { skills: [{ name: "notes", description: "Notes", source: "cloud", enabled: true }] });
      if (method === "GET" && route === "/api/bots/ember/skills/notes") return reply(200, { text: "OLD" });
      if (method === "POST" && route.endsWith("/skill-template")) return ++installs === 1 ? reply(422, { error: "SKILL.md is invalid" }) : reply(201, {});
      return reply(200, {});
    },
    upload: async () => reply(201, {}), close: async () => {},
  };
  const localJson = (value) => new Response(JSON.stringify(value), { status: 200 });
  const send = createCloudSend({
    local: async (route) => route === "/api/cloud-send" ? localJson(summary([bot("ember", { soul: "s" }), skill]))
      : route === "/api/bots/ember/skills" ? localJson({ skills: [{ name: "notes", description: "Notes", source: "here", enabled: true }] })
        : localJson({ text: "NEW" }),
    cloud: { origin: () => CLOUD, asleep: () => false, read: async () => localJson(summary([])), open: async () => session },
    handoff: async () => ({}), store: { read: () => ({ clouds: { [CLOUD]: { sent: { [skill.key]: { text: ["old", "old"], on: ["on", "on"] } } } } }), write() {} },
    setTimer: () => 0, clearTimer() {},
  });
  const outcome = await send.send();
  assert.equal(outcome.result.failed[0]?.error, "My Cloud said: SKILL.md is invalid");
  assert.deepEqual(calls.filter((call) => /skill/.test(call)), [
    "GET /api/bots/ember/skills", "GET /api/bots/ember/skills/notes", "DELETE /api/bots/ember/skills/notes",
    "POST /api/bots/ember/skill-template NEW", "POST /api/bots/ember/skill-template OLD",
  ]);
});

test("a send asked while another runs waits for it, then runs as it was asked", async () => {
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" }), { key: itemKey.onePassword(), kind: "1password", label: "1Password", parts: { token: "t" } }] });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const open = sides.deps.cloud.open;
  let opened = 0;
  sides.deps.cloud.open = async () => { if (opened++ === 0) await gate; return open(); };
  const send = createCloudSend(sides.deps);
  const first = send.send({ keys: ["bot:ember"] });
  const second = send.send({ keys: ["1password"], force: ["1password"] });
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(opened, 2);
  assert.deepEqual([a.result.bots, b.result.bots], [["Ember"], []]);
  assert.deepEqual(b.result.failed.map((entry) => entry.key), ["1password"], "the second send carried its own keys");
});

test("a send that stops as a whole is that send's outcome, so the strip and Settings say why instead of an earlier result", async () => {
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  const send = createCloudSend(sides.deps);
  await send.send();
  assert.equal(send.snapshot().last.result.bots.length, 1);
  sides.deps.cloud.open = async () => { throw new Error("Too many connection links. Wait a few minutes and try again."); };
  await assert.rejects(send.send({ reason: "my-cloud" }), /could not sign in|Too many connection links/);
  const last = send.snapshot().last;
  assert.equal(last.reason, "my-cloud");
  assert.equal(last.error, "Too many connection links. Wait a few minutes and try again.");
  const told = sendNotice(send.snapshot()).last;
  assert.deepEqual({ failed: told.failed, error: told.error, reason: told.reason, seen: told.seen }, { failed: 0, error: "Too many connection links. Wait a few minutes and try again.", reason: "my-cloud", seen: false });
});

test("My Cloud's notice says what did not go, by kind, with each reason: logins only counted, never a site", async () => {
  const login = (id, site) => ({ key: itemKey.login(site, "amit"), kind: "login", label: site, detail: "amit", id, parts: { saved: id } });
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" }), login("l1", "bank.example"), login("l2", "crm.example"), { key: itemKey.onePassword(), kind: "1password", label: "1Password", parts: { token: "t" } }] });
  sides.deps.handoff = async (what) => {
    if (what.kind === "login") throw new Error("OpenMausBot on this computer did not answer. Try again.");
    throw new Error("1Password did not accept this computer's token, so it was not sent to My Cloud.");
  };
  const send = createCloudSend(sides.deps);
  const outcome = await send.send();
  assert.deepEqual(outcome.result.bots, ["Ember"]);
  assert.deepEqual(outcome.result.failed.map((entry) => entry.kind), ["login", "login", "1password"]);
  const notice = sendNotice(send.snapshot());
  const none = { bots: [], skills: 0, logins: 0, onePassword: false, settings: 0, chats: false };
  assert.deepEqual(notice.last.reasons, [
    { what: { ...none, logins: 2 }, error: "OpenMausBot on this computer did not answer. Try again." },
    { what: { ...none, onePassword: true }, error: "1Password did not accept this computer's token, so it was not sent to My Cloud." },
  ]);
  assert.equal(notice.last.error, undefined, "the send itself did not stop");
  assert.ok(!JSON.stringify(notice).includes("bank.example") && !JSON.stringify(notice).includes("crm.example"));
});

test("1Password refused on My Cloud is told in words for this computer, not My Cloud's own paste-it-here", async () => {
  const sides = fakeSides({ localItems: [{ key: itemKey.onePassword(), kind: "1password", label: "1Password", parts: { token: "t" } }],
    refuse: { "/api/logins/1password": { status: 400, error: "1Password did not accept the token: it may have been revoked, expired, or lost access to its vault. Make a new service account token in 1Password and paste it here." } } });
  sides.deps.handoff = async () => ({ onePassword: { token: "ops_fake", grants: {} } });
  const outcome = await createCloudSend(sides.deps).send();
  assert.deepEqual(outcome.result.failed, [{ key: "1password", kind: "1password", label: "1Password",
    error: "My Cloud's 1Password did not accept this computer's token: it may have been revoked, expired, or lost access to its vault. Connect 1Password again in this computer's Settings → Logins, and it goes to My Cloud by itself.", final: true }]);
  const other = fakeSides({ localItems: [{ key: itemKey.onePassword(), kind: "1password", label: "1Password", parts: { token: "t" } }],
    refuse: { "/api/logins/1password": { status: 503, error: "busy" } } });
  other.deps.handoff = async () => ({ onePassword: { token: "ops_fake", grants: {} } });
  const busy = await createCloudSend(other.deps).send();
  assert.equal(busy.result.failed[0].final, undefined, "any other refusal can be tried again");
});

test("a Cloud too old to take chats by row gets Bring newer chats' copy from a send the person asked for or the first one, never the background one or a send of one item", async () => {
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  const asked = [];
  let answer = { conversations: 3, messages: 40 };
  sides.deps.bringChats = async () => { asked.push(true); sides.calls.push("chats"); if (answer instanceof Error) throw answer; return answer; };
  const send = createCloudSend(sides.deps);
  for (const reason of ["button", "my-cloud", "menu", "first"]) {
    asked.length = 0;
    assert.deepEqual((await send.send({ reason })).result.chats, { conversations: 3, messages: 40 }, reason);
    assert.equal(asked.length, 1, reason);
    assert.ok(sides.calls.lastIndexOf("logout") < sides.calls.lastIndexOf("chats"), "the items' session is signed out before the chats go");
  }
  asked.length = 0;
  for (const options of [{ reason: "auto" }, { reason: "logins", keys: ["1password"] }, { keys: ["bot:ember"] }]) {
    assert.equal((await send.send(options)).result.chats, null, JSON.stringify(options));
  }
  assert.equal(asked.length, 0);
  answer = new Error("Wait for bots on this computer to finish what they are doing, then copy again.");
  const outcome = await send.send();
  assert.deepEqual(outcome.result.failed, [{ key: "chats", kind: "chats", label: "Chats", error: "Wait for bots on this computer to finish what they are doing, then copy again." }]);
  assert.deepEqual(sendNotice(send.snapshot()).last.reasons, [{ what: { bots: [], skills: 0, logins: 0, onePassword: false, settings: 0, chats: true },
    error: "Wait for bots on this computer to finish what they are doing, then copy again." }]);
});

test("Bring newer chats' answer becomes the send's chats, and a copy already running is said plainly", async () => {
  const handlers = new Map();
  let state = { phase: "done", action: "bring", brought: { conversations: 2, messages: 9, intoExisting: 4, skippedBots: 0, skippedRooms: 0, deleted: 0 } };
  let pairing = true;
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  const localResponse = sides.deps.local;
  installCloudSend({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, localOnly: (_channel, handler) => handler, cloudPage: () => "cloud",
    server: () => null, local: localResponse, home: () => ({ origin: CLOUD, grant: async () => ({ origin: CLOUD, code: "C" }) }),
    cookieFetch: async () => new Response(JSON.stringify(summary([])), { status: 200 }), reconnect: async () => false, power: { asleep: () => false },
    file: () => "/nonexistent/cloud-send.json", window: () => null, localOrigin: () => LOCAL, openSettings() {}, keepUpToDate: false,
    fetch: async (url) => String(url).endsWith("/api/auth/pair") && !pairing ? new Response("{}", { status: 401 })
      : new Response(JSON.stringify(String(url).endsWith("/api/auth/pair") ? { token: "omb_sess_fake" } : String(url).endsWith("/api/cloud-send") ? summary([]) : {}), { status: 200 }),
    bringChats: async () => state,
  });
  assert.deepEqual((await handlers.get("cloud-send:send")({})).result.chats, { conversations: 2, messages: 9 });
  state = { phase: "uploading", action: "move" };
  const notice = await handlers.get("cloud-send:page-send")({});
  assert.deepEqual(notice.last.reasons?.map((reason) => [reason.what.chats, reason.error]), [[true, "Another copy to My Cloud is running. Send again when it has finished."]]);
  // The strip's send never loses why a send stopped in a rejected call.
  pairing = false;
  const { failed, error, reasons } = (await handlers.get("cloud-send:page-send")({})).last;
  assert.deepEqual({ failed, error, reasons }, { failed: 0, error: "This app could not sign in to My Cloud. Try again.", reasons: undefined });
});

test("with Keep My Cloud up to date off before this computer meets a Cloud, nothing goes by itself, the first send included", async () => {
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  let fire = null;
  const send = createCloudSend({ ...sides.deps, store: { read: () => ({ auto: false }), write() {} }, setTimer: (callback) => { fire = callback; return 1; }, clearTimer() {} });
  send.start();
  const run = fire; fire = null; await run();
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sides.calls, []);
  assert.equal(send.snapshot().last, null);
  assert.equal(send.waiting(), null, "nothing compared yet");
});

test("chats by row: the cursor moves only past what My Cloud took; one removed there is never sent again; one being answered waits", async () => {
  const rows = { "t-a": [{ id: "a1", at: 1 }, { id: "a2", at: 2 }], "t-b": [{ id: "b1", at: 1 }], "t-c": [{ id: "c1", at: 1 }] };
  const heads = () => Object.entries(rows).map(([threadId, list]) => ({ bot: "ember", threadId, last: list.length, lastId: list.at(-1).id, busy: threadId === "t-c" }));
  const posted = [];
  let removedThere = new Set();
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })], cloudItems: [bot("ember", { soul: "s" })] });
  const call = sides.deps.cloud.open;
  sides.deps.cloud.open = async () => {
    const session = await call();
    const inner = session.call;
    session.call = async (method, route, body) => {
      if (route === "/api/cloud-send") return { status: 200, ok: true, body: { ...summary([bot("ember", { soul: "s" })]), chats: 1 } };
      if (route === "/api/cloud-send/chats") {
        posted.push(body.conversations.map((entry) => [entry.threadId, entry.rows.map((row) => row.id), entry.sent]));
        const removed = body.conversations.filter((entry) => removedThere.has(entry.threadId)).map((entry) => entry.threadId);
        return { status: 200, ok: true, body: { conversations: 0, messages: 1, accepted: body.conversations.map((entry) => entry.threadId).filter((id) => !removed.includes(id)), waiting: [], removed } };
      }
      return inner(method, route, body);
    };
    return session;
  };
  const local = sides.deps.local;
  sides.deps.local = async (route) => {
    if (route === "/api/cloud-send/chats") return new Response(JSON.stringify({ v: 1, dataDir: "/desk/.openmausbot", conversations: heads() }), { status: 200 });
    const asked = /^\/api\/cloud-send\/chats\/rows\?thread=([\w-]+)&after=(\d+)&id=/u.exec(route);
    if (asked) {
      const list = rows[asked[1]], from = Number(asked[2]);
      return new Response(JSON.stringify({ rows: list.slice(from), leaf: list.at(-1).id, task: null, last: list.length, lastId: list.at(-1).id, more: false, restarted: false, attachments: [] }), { status: 200 });
    }
    return local(route);
  };
  const send = createCloudSend(sides.deps);
  await send.send();
  assert.deepEqual(posted.at(-1), [["t-a", ["a1", "a2"], false], ["t-b", ["b1"], false]], "the conversation being answered waits");
  rows["t-a"].push({ id: "a3", at: 3 });
  rows["t-b"].push({ id: "b2", at: 2 });
  removedThere = new Set(["t-b"]);
  await send.send();
  assert.deepEqual(posted.at(-1), [["t-a", ["a3"], true], ["t-b", ["b2"], true]], "only the new rows, each marked as sent before");
  rows["t-b"].push({ id: "b3", at: 3 });
  await send.send();
  assert.deepEqual(posted.length, 2, "nothing new but in a conversation removed on My Cloud: no request at all");
});

test("1Password refusing the token on My Cloud is final: My Cloud's page is told not to offer Try again; any other failure keeps it", () => {
  const outcome = (failed, error) => ({ cloud: "ready", rows: [], last: { at: 1, reason: "auto", result: { bots: [], updatedBots: [], skills: 0, logins: 0, onePassword: false, settings: [], chats: null, notes: [], failed }, ...(error ? { error } : {}) } });
  const refused = { key: "1password", kind: "1password", label: "1Password", error: "refused", final: true };
  const other = { key: "login:a", kind: "login", label: "a.example", error: "did not answer" };
  assert.equal(sendNotice(outcome([refused])).last.final, true);
  assert.equal(sendNotice(outcome([refused, other])).last.final, false);
  assert.equal(sendNotice(outcome([])).last.final, false);
  assert.equal(sendNotice(outcome([refused], "stopped")).last.final, false, "a send that stopped as a whole can be tried again");
});


/** Bot conversations of `count` rows each, handed `page` rows at a time, and a My Cloud whose chats route answers each
 * entry with `answer(entry, post)` ("accepted", "waiting" or "removed"). */
function chatSides({ threads, page = 300, answer = () => "accepted", onPost = () => {}, onRead = () => {}, attachments = () => [], cloudSummary = null } = {}) {
  const rows = Object.fromEntries(Object.entries(threads).map(([threadId, count]) => [threadId, Array.from({ length: count }, (_, i) => ({ id: `${threadId}-${i + 1}`, at: i + 1 }))]));
  const posted = [], checked = [];
  const ember = [bot("ember", { soul: "s" })];
  const sides = fakeSides({ localItems: ember, cloudItems: ember });
  const theirs = { ...summary(ember), chats: 1, ...cloudSummary };
  sides.deps.cloud.read = async () => new Response(JSON.stringify(theirs), { status: 200 });
  const open = sides.deps.cloud.open;
  sides.deps.cloud.open = async () => {
    const session = await open();
    const inner = session.call;
    session.call = async (method, route, body) => {
      if (route === "/api/cloud-send") return { status: 200, ok: true, body: theirs };
      if (route === "/api/cloud-send/chats/attachments") { checked.push(body.names.length); return { status: body.names.length > 2000 ? 400 : 200, ok: body.names.length <= 2000, body: { missing: [] } }; }
      if (route === "/api/cloud-send/chats") {
        posted.push(body.conversations.map((entry) => ({ threadId: entry.threadId, rows: entry.rows.map((row) => row.id), sent: entry.sent })));
        const said = body.conversations.map((entry) => [entry.threadId, answer(entry, posted.length)]);
        const of = (kind) => said.filter(([, answered]) => answered === kind).map(([threadId]) => threadId);
        const reply = { status: 200, ok: true, body: { conversations: 0, messages: body.conversations.reduce((sum, entry) => sum + entry.rows.length, 0), accepted: of("accepted"), waiting: of("waiting"), removed: of("removed") } };
        onPost(posted.length);
        return reply;
      }
      return inner(method, route, body);
    };
    return session;
  };
  const local = sides.deps.local;
  const json = (value) => new Response(JSON.stringify(value), { status: 200 });
  sides.deps.local = async (route) => {
    if (route === "/api/cloud-send/chats") return json({ v: 1, dataDir: "/desk/.openmausbot", conversations: Object.entries(rows).map(([threadId, list]) => ({ bot: "ember", threadId, last: list.length, lastId: list.at(-1).id, busy: false })) });
    const asked = /^\/api\/cloud-send\/chats\/rows\?thread=([\w-]+)&after=(\d+)&id=/u.exec(route);
    if (asked) {
      onRead(asked[1]);
      const list = rows[asked[1]], from = Number(asked[2]);
      const slice = list.slice(from, from + page), last = from + slice.length;
      return json({ rows: slice, leaf: slice.at(-1)?.id ?? null, task: null, last, lastId: list[last - 1]?.id ?? null, more: last < list.length, restarted: false, attachments: attachments(slice) });
    }
    return local(route);
  };
  return { sides, rows, posted, checked };
}
const stored = () => { let value = null; return { read: () => value, write: (next) => { value = structuredClone(next); }, get value() { return value; } }; };
/** Keep My Cloud up to date's own timer, run by hand: `tick(ms)` moves the clock on and runs the check that is due. */
function clocked(deps) {
  const clock = { now: 1_000, fire: null, waits: [] };
  const send = createCloudSend({ ...deps, now: () => clock.now, setTimer: (callback, ms) => { clock.fire = callback; clock.waits.push(ms); return clock.waits.length; }, clearTimer() { clock.fire = null; } });
  const settle = async () => { for (let i = 0; i < 200; i++) await new Promise((resolve) => setImmediate(resolve)); };
  const tick = async (ms = 0) => { clock.now += ms; const run = clock.fire; clock.fire = null; run?.(); await settle(); };
  return { send, clock, tick, settle };
}
const fortyOnePages = () => ({ ...Object.fromEntries(Array.from({ length: 39 }, (_, i) => [`t${i}`, 1])), long: 4 });

test("a conversation split over two requests: its later page says it went before, so one removed on My Cloud in between stays removed", async () => {
  const { sides, posted } = chatSides({ threads: fortyOnePages(), page: 2 });
  await createCloudSend(sides.deps).send();
  assert.equal(posted.length, 2);
  assert.deepEqual(posted.flat().filter((entry) => entry.threadId === "long"), [
    { threadId: "long", rows: ["long-1", "long-2"], sent: false },
    { threadId: "long", rows: ["long-3", "long-4"], sent: true },
  ]);
});

test("once My Cloud does not take a page, the conversation's later pages wait too, and the next send starts it where My Cloud stopped", async () => {
  const { sides, posted } = chatSides({ threads: fortyOnePages(), page: 2, answer: (entry, post) => entry.threadId === "long" && post === 1 ? "waiting" : "accepted" });
  const send = createCloudSend({ ...sides.deps, store: stored() });
  await send.send();
  assert.deepEqual(posted.flat().filter((entry) => entry.threadId === "long").map((entry) => entry.rows), [["long-1", "long-2"]]);
  await send.send();
  assert.deepEqual(posted.slice(-1).flat().map((entry) => entry.rows), [["long-1", "long-2"], ["long-3", "long-4"]]);
});

test("a conversation this computer never sent is never kept as removed, so it goes again", async () => {
  let removed = true;
  const { sides, posted } = chatSides({ threads: { kept: 1, other: 1 }, answer: (entry) => entry.threadId === "kept" && removed ? "removed" : "accepted" });
  const store = stored();
  const send = createCloudSend({ ...sides.deps, store });
  await send.send();
  assert.equal(store.value.clouds[CLOUD].chats.kept, undefined);
  removed = false;
  await send.send();
  assert.deepEqual(posted.at(-1).map((entry) => entry.threadId), ["kept"]);
  assert.deepEqual(store.value.clouds[CLOUD].chats.kept, { after: 1, id: "kept-1" });
});

test("turning off Keep My Cloud up to date stops a send under way before the next conversation, and says it was turned off", async () => {
  const threads = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`c${i}`, 1]));
  let off = () => {}, readAfterOff = 0;
  const { sides, posted } = chatSides({ threads, onPost: (post) => { if (post === 1) off(); }, onRead: () => { if (posted.length) readAfterOff++; } });
  const store = stored();
  const { send, tick } = clocked({ ...sides.deps, store });
  off = () => send.setAuto(false);
  send.start();
  await tick(20_000);
  assert.equal(posted.length, 1, "nothing went after the switch was turned off");
  assert.equal(readAfterOff, 0, "no conversation is read once the switch is off");
  assert.deepEqual(posted[0].map((entry) => entry.threadId), Object.keys(threads).slice(0, 40));
  const last = send.snapshot().last;
  assert.deepEqual([last.reason, last.stopped, last.result.failed], ["first", "off", []]);
  assert.equal(Object.keys(store.value.clouds[CLOUD].chats).length, 40, "what My Cloud took is kept");
  // Turned on again: the first send goes on from where it stopped, still the first one.
  send.setAuto(true);
  await tick(1_000);
  assert.deepEqual(posted.at(-1).map((entry) => entry.threadId), Object.keys(threads).slice(40));
  assert.equal(send.snapshot().last.reason, "first");
  assert.equal(send.snapshot().last.stopped, undefined);
});

test("turned off while the last conversation is read, a send stops before its request; turned off between bots, the rest stay here", async () => {
  let off = () => {};
  const late = chatSides({ threads: { a: 1, b: 1, c: 1 }, onRead: (threadId) => { if (threadId === "c") off(); } });
  const first = clocked({ ...late.sides.deps, store: stored() });
  off = () => first.send.setAuto(false);
  first.send.start();
  await first.tick(20_000);
  assert.deepEqual(late.posted, []);
  assert.equal(first.send.snapshot().last.stopped, "off");

  const three = [bot("ember", { soul: "s" }), bot("juno", { soul: "j" }), bot("kit", { soul: "k" })];
  const items = fakeSides({ localItems: three });
  const local = items.deps.local;
  items.deps.local = async (route) => route === "/api/bots?messages=0"
    ? new Response(JSON.stringify({ bots: three.map((entry) => ({ id: entry.id, threadId: `t-${entry.id}`, name: entry.label })) }), { status: 200 }) : local(route);
  const open = items.deps.cloud.open;
  let between = () => {};
  items.deps.cloud.open = async () => {
    const session = await open();
    const call = session.call;
    session.call = async (method, route, body) => { const answered = await call(method, route, body); if (method === "POST" && route === "/api/bots") between(); return answered; };
    return session;
  };
  const second = clocked(items.deps);
  between = () => second.send.setAuto(false);
  second.send.start();
  await second.tick(20_000);
  assert.equal(items.calls.filter((entry) => entry === "POST /api/bots").length, 1);
  assert.deepEqual(second.send.snapshot().last.result.bots, ["ember"]);
  assert.equal(second.send.snapshot().last.stopped, "off");
});

test("a send that fails as a whole waits half an hour like any other failure, instead of signing in again every two minutes", async () => {
  const { sides } = chatSides({ threads: { a: 1 } });
  let opened = 0;
  sides.deps.cloud.open = async () => { opened++; throw new Error("This app could not sign in to My Cloud. Try again."); };
  const { send, tick } = clocked(sides.deps);
  send.start();
  await tick();
  for (let i = 0; i < 14; i++) await tick(2 * 60_000);
  assert.equal(opened, 1, "one sign-in in the half hour after a failure");
  await tick(4 * 60_000);
  assert.equal(opened, 2);
});

test("more attachments than My Cloud checks at once go in several checks, so the chats still go", async () => {
  const names = Array.from({ length: 2500 }, (_, i) => `${String(i).padStart(8, "0")}.png`);
  const { sides, posted, checked } = chatSides({ threads: { pics: 1 }, attachments: () => names });
  const outcome = await createCloudSend(sides.deps).send();
  assert.deepEqual(checked, [2000, 500]);
  assert.deepEqual(outcome.result.failed, []);
  assert.equal(posted.length, 1);
});

test("a Cloud this computer has not sent to yet gets its first send a moment after it is there, not at the next two-minute check", async () => {
  let origin = CLOUD;
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  sides.deps.cloud.origin = () => origin;
  const { send, clock, tick } = clocked(sides.deps);
  send.start();
  send.kick();
  assert.deepEqual(clock.waits, [20_000], "never sooner than the first check after the app starts");
  origin = null;
  await tick(20_000);
  assert.equal(clock.waits.at(-1), 2 * 60_000, "no Cloud yet: the usual check");
  send.kick();
  assert.equal(clock.waits.at(-1), 2 * 60_000, "a kick without a Cloud does nothing");
  origin = CLOUD;
  send.kick();
  assert.equal(clock.waits.at(-1), 1_000);
  const waits = clock.waits.length;
  send.kick();
  assert.equal(clock.waits.length, waits, "a kick never puts off a check already due");
  await tick(1_000);
  assert.equal(send.snapshot().last.reason, "first");
  assert.ok(sides.calls.includes("POST /api/bots"));
  send.kick();
  assert.equal(clock.waits.at(-1), 2 * 60_000, "once something was sent, a kick does nothing");
});

test("a kick while a check runs never starts a second one at once; the next check comes a moment after", async () => {
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" })] });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const reads = [];
  const read = sides.deps.cloud.read;
  sides.deps.cloud.read = async (route) => { reads.push(route); await gate; return read(route); };
  const { send, clock, tick, settle } = clocked(sides.deps);
  send.start();
  const running = tick(20_000);
  await settle();
  const waits = clock.waits.length;
  send.kick();
  assert.equal(clock.waits.length, waits, "nothing scheduled while the check runs");
  release();
  await running;
  await settle();
  assert.equal(reads.length, 1);
  assert.equal(clock.waits.at(-1), 1_000);
});

test("main's kick, on the account's changes, brings a new Cloud's first send forward", async () => {
  let now = 1_000, home = null, fire = null;
  const waits = [];
  const main = installCloudSend({
    ipcMain: { handle() {} }, localOnly: (_channel, handler) => handler, cloudPage: () => "local",
    server: () => null, local: async () => new Response("{}", { status: 503 }), home: () => home,
    cookieFetch: async () => new Response("", { status: 401 }), reconnect: async () => false, power: { asleep: () => false },
    file: () => "/nonexistent/cloud-send.json", window: () => null, localOrigin: () => LOCAL, openSettings() {},
    clock: { now: () => now, setTimer: (callback, ms) => { fire = callback; waits.push(ms); return waits.length; }, clearTimer() {} },
  });
  now += 20_000;
  fire();
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  main.kick();
  assert.deepEqual(waits, [20_000, 2 * 60_000], "no Cloud: nothing to bring forward");
  home = { origin: CLOUD, grant: async () => ({ origin: CLOUD, code: "C" }) };
  main.kick();
  assert.deepEqual(waits, [20_000, 2 * 60_000, 1_000]);
});

test("My Cloud's page is told the latest whole send, which a later one-login send never replaces, and all that ever arrived", async () => {
  const login = { key: itemKey.login("bank.example", "amit"), kind: "login", label: "bank.example", detail: "amit", id: "l1", parts: { saved: "1" } };
  const sides = fakeSides({ localItems: [bot("ember", { soul: "s" }), login] });
  sides.deps.handoff = async () => ({ login: { site: "bank.example", username: "amit", password: "fake-pass", bots: [] } });
  const store = stored();
  const send = createCloudSend({ ...sides.deps, store });
  await send.send({ keys: [login.key], force: [login.key], reason: "logins" });
  assert.equal(sendNotice(send.snapshot()).whole, null, "one login is not a whole send");
  await send.send({ reason: "first" });
  await send.send({ keys: [login.key], force: [login.key], reason: "logins" });
  const notice = sendNotice(send.snapshot());
  assert.deepEqual([notice.last.reason, notice.whole.reason, notice.whole.sent.bots], ["logins", "first", 1]);
  assert.deepEqual(notice.arrived, { bots: 1, updatedBots: 0, skills: 0, logins: 3, settings: 0, onePassword: false, chats: { conversations: 0, messages: 0 } });
  sides.deps.cloud.open = async () => { throw new Error("This app could not sign in to My Cloud. Try again."); };
  await assert.rejects(send.send({ reason: "auto" }));
  assert.equal(sendNotice(send.snapshot()).whole.error, "This app could not sign in to My Cloud. Try again.");
  const kept = parseSendState(store.value).clouds[CLOUD];
  assert.deepEqual([kept.whole.reason, kept.arrived.logins], ["auto", 3]);
  assert.deepEqual(parseSendState({ clouds: { [CLOUD]: { whole: { at: "x" }, arrived: { bots: -2, logins: 1.5, chats: "lots" } } } }).clouds[CLOUD].arrived,
    { bots: 0, updatedBots: 0, skills: 0, logins: 0, settings: 0, onePassword: false, chats: { conversations: 0, messages: 0 } });
});

/** chatSides whose My Cloud can go away (`down`: reads and sessions fail) or sign this app out (`signedOut`). */
function awaySides(threads) {
  const sides = chatSides({ threads });
  const state = { down: false, signedOut: false, reads: 0, opened: 0 };
  const read = sides.sides.deps.cloud.read, open = sides.sides.deps.cloud.open;
  sides.sides.deps.cloud.read = async (route) => {
    state.reads++;
    if (state.down) throw new TypeError("fetch failed");
    return state.signedOut ? new Response("", { status: 401 }) : read(route);
  };
  sides.sides.deps.cloud.open = async () => { state.opened++; if (state.down) throw new Error("This app could not sign in to My Cloud. Try again."); return open(); };
  return { ...sides, state };
}

test("once My Cloud is back after being away, the next check sends what waited, instead of the half-hour round", async () => {
  const { sides, rows, posted, state } = awaySides({ a: 1 });
  const { send, tick } = clocked({ ...sides.deps, store: stored() });
  send.start();
  await tick(20_000);
  assert.equal(posted.length, 1);
  rows.a.push({ id: "a-2", at: 2 });
  state.down = true;
  await tick(6 * 60_000);
  assert.equal(send.snapshot().cloud, "unreachable");
  state.down = false;
  await tick(2 * 60_000);
  assert.deepEqual(posted.at(-1), [{ threadId: "a", rows: ["a-2"], sent: true }]);
  assert.equal(send.snapshot().cloud, "ready", "Settings no longer says My Cloud didn't answer");
});

test("a kick when the account changes looks at a Cloud the last look found away, at most every 30 seconds", async () => {
  const { sides, rows, posted, state } = awaySides({ a: 1 });
  const { send, clock, tick } = clocked({ ...sides.deps, store: stored() });
  send.start();
  await tick(20_000);
  rows.a.push({ id: "a-2", at: 2 });
  state.down = true;
  await tick(6 * 60_000);
  state.down = false;
  send.kick();
  assert.equal(clock.waits.at(-1), 30_000);
  await tick(30_000);
  assert.deepEqual(posted.at(-1), [{ threadId: "a", rows: ["a-2"], sent: true }]);
  send.kick();
  assert.equal(clock.waits.at(-1), 2 * 60_000, "back and in step: a kick does nothing");
});

test("a Cloud that stays away is read once a check and never signed in to; signed out, it is not read every check", async () => {
  const { sides, rows, state } = awaySides({ a: 1 });
  const { send, tick } = clocked({ ...sides.deps, store: stored() });
  send.start();
  await tick(20_000);
  rows.a.push({ id: "a-2", at: 2 });
  state.down = true;
  await tick(6 * 60_000);
  const [reads, opened] = [state.reads, state.opened];
  for (let i = 0; i < 15; i++) await tick(2 * 60_000);
  assert.equal(state.reads - reads, 15);
  assert.equal(state.opened, opened, "no sign-in while it is away");
  state.down = false;
  state.signedOut = true;
  await tick(2 * 60_000);
  assert.equal(send.snapshot().cloud, "signed-out");
  const before = state.reads;
  for (let i = 0; i < 10; i++) await tick(2 * 60_000);
  assert.ok(state.reads - before <= 1, `read ${state.reads - before} times in 20 minutes while signed out`);
});

test("a send that failed before My Cloud went away is tried again as soon as it is back", async () => {
  const { sides, rows, posted, state } = awaySides({ a: 1 });
  const { send, tick } = clocked({ ...sides.deps, store: stored() });
  send.start();
  await tick(20_000);
  rows.a.push({ id: "a-2", at: 2 });
  state.down = true;
  const read = sides.deps.cloud.read;
  sides.deps.cloud.read = async (route) => { if (state.down && state.reads === 1) { state.reads++; return new Response(JSON.stringify({ ...summary([bot("ember", { soul: "s" })]), chats: 1 }), { status: 200 }); } return read(route); };
  await tick(6 * 60_000);
  assert.ok(send.snapshot().last.error, "the send failed as a whole");
  await send.compare();
  assert.equal(send.snapshot().cloud, "unreachable");
  state.down = false;
  await tick(2 * 60_000);
  assert.deepEqual(posted.at(-1), [{ threadId: "a", rows: ["a-2"], sent: true }]);
});
