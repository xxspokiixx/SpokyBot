import assert from "node:assert/strict";
import test from "node:test";

import { createOneHome, QUIET_MS } from "./one-home.mjs";
import { parseCloudSummary } from "./cloud-home.mjs";
import { oneHomeCloud } from "./one-home-main.mjs";

const CLOUD = "https://omb-t-1.fly.dev";
const reply = (status, body = {}) => ({ ok: status < 400, status, body });

/**
 * Two computers that both moved to one My Cloud, each with its own app, journal and server, and the Admin's word shared
 * between them. Each server's automations are on or off; while a server is not frozen, every automation that is on runs
 * (`live`), which is what the schedulers spy on. My Cloud holds what both brought plus one made there since; the
 * Admin's export of it is counted per computer, and refused to any computer but the one it names.
 */
function desks({ homecoming = "a" } = {}) {
  let clock = 1_000_000;
  const timers = [];
  const admin = { ended: false, answers: true, homecoming, starting: false, exportAsks: { a: 0, b: 0 } };
  const cloudOn = { "routine:a1": true, "routine:b1": true, "webhook:bw": true, "routine:c1": true };
  const make = (id, name, own) => {
    const desk = {
      id, name, journal: null, journalWrites: [], server: { frozen: false, on: { ...own }, thaws: [] }, localCalls: [], opened: [], phoneStarts: 0, restarted: 0, brought: 0,
      live: () => (desk.server.frozen ? [] : Object.keys(desk.server.on).filter((key) => desk.server.on[key]).sort()),
      home: null,
      crashOn: null,
    };
    desk.make = () => createOneHome({
      journal: {
        read: () => structuredClone(desk.journal),
        write: (value) => {
          if (desk.crashOn?.(value)) { desk.crashOn = null; throw new Error("the app was killed"); }
          desk.journalWrites.push(structuredClone(value));
          desk.journal = structuredClone(value);
        },
      },
      cloud: () => (admin.answers ? { origin: CLOUD, account: "acct-1", machine: CLOUD, ready: !admin.ended, moves: true, ended: admin.ended, paid: !admin.ended,
        ...(admin.ended && admin.homecoming ? { homecoming: { name: admin.homecoming === "a" ? "MacBook Air" : "Studio iMac", here: admin.homecoming === id } } : {}) } : null),
      send: { move: async () => {}, check: async () => ({ ok: true }), switches: () => ({ ...own }), snapshot: () => ({ running: null }) },
      local: {
        async freeze() { desk.server.frozen = true; return { frozen: true }; },
        async unfreeze(options) {
          desk.server.thaws.push(options ?? null);
          if (options?.automations === "off") for (const key of Object.keys(desk.server.on)) desk.server.on[key] = false;
          desk.server.frozen = false;
        },
        frozen: async () => desk.server.frozen,
        async json(route) {
          if (route === "/api/cloud-connections") return { computer: { label: name } };
          if (route.startsWith("/api/bots")) return { bots: [] };
          return { items: [], conversations: [], automations: [] };
        },
        async call(method, route, body) {
          desk.localCalls.push([method, route, body]);
          const match = /^\/api\/(routines|webhooks)\/([\w-]+)$/u.exec(route);
          if (method === "PATCH" && match && body?.enabled === true) desk.server.on[`${match[1] === "routines" ? "routine" : "webhook"}:${match[2]}`] = true;
          return reply(200);
        },
      },
      session: async () => ({ call: async () => reply(200, { v: 1 }), close: async () => {} }),
      phone: { paired: () => true, stop: async () => {}, start: async () => { desk.phoneStarts++; } },
      openHome: () => desk.opened.push("cloud"),
      openLocal: () => desk.opened.push("local"),
      lastInput: () => 0,
      again: {
        async bring() {
          desk.brought++;
          admin.exportAsks[id]++;
          if (admin.homecoming && admin.homecoming !== id) throw new Error("Your bots came back to MacBook Air. Only that computer brings My Cloud's things home.");
          if (admin.starting) return { later: 60_000 };
          // The restore leaves every automation off, with what My Cloud had; then what was on there is switched on.
          desk.server.on = Object.fromEntries(Object.keys(cloudOn).map((key) => [key, false]));
          return { restored: `restore-${id}`, switches: { ...cloudOn } };
        },
      },
      restart: () => { desk.restarted++; },
      version: "0.1.122",
      now: () => clock,
      timers: { set: (work, ms) => { const timer = { work, ms }; timers.push(timer); return timer; }, clear: (timer) => { const at = timers.indexOf(timer); if (at >= 0) timers.splice(at, 1); } },
    });
    desk.relaunch = () => { desk.home?.close(); desk.home = desk.make(); return desk.home; };
    desk.home = desk.make();
    return desk;
  };
  const w = {
    admin, clock: () => clock,
    a: make("a", "MacBook Air", { "routine:a1": true }),
    b: make("b", "Studio iMac", { "routine:b1": true, "webhook:bw": true }),
    advance(ms) { clock += ms; },
    async tick(desk) { const due = timers.splice(0); for (const timer of due) timer.work(); await desk.home.kick(); },
    /** Both computers moved: each is frozen, and My Cloud is their home. */
    async moved() {
      w.advance(QUIET_MS + 1);
      for (const desk of [w.a, w.b]) { await desk.home.kick(); assert.equal(desk.journal.phase, "done", desk.name); assert.equal(desk.server.frozen, true); }
      // A computer's own automations went to My Cloud: frozen here, they no longer run.
      assert.deepEqual([w.a.live(), w.b.live()], [[], []]);
    },
  };
  return w;
}

/** Each automation runs on at most one computer. */
const runsOnBoth = (w) => w.a.live().filter((key) => w.b.live().includes(key));

/** One computer alone, with an Admin that names no computer: what it writes, asks its server and opens, as it comes home. */
async function alone() {
  const w = desks({ homecoming: null });
  w.advance(QUIET_MS + 1);
  await w.a.home.kick();
  w.admin.ended = true;
  await w.a.home.kick();
  await w.a.relaunch().kick();
  return { writes: w.a.journalWrites, thaws: w.a.server.thaws, calls: w.a.localCalls, opened: w.a.opened, phone: w.a.phoneStarts, restarted: w.a.restarted, view: w.a.home.view() };
}

test("My Cloud ends after two computers moved to it: the one the Admin names restores it and runs its automations; the other opens its own copy with every automation off", async () => {
  const w = desks();
  await w.moved();
  const frozenAt = w.b.journal.frozenAt;
  w.admin.ended = true;

  // The other computer goes first, and waits for nothing: its own copy, as it was at the move, with automations off.
  await w.b.home.kick();
  assert.deepEqual(w.b.server.thaws, [{ automations: "off" }]);
  assert.equal(w.b.server.frozen, false, "the person isn't locked out of it");
  assert.deepEqual(w.b.live(), [], "and none of its automations runs");
  assert.deepEqual(Object.values(w.b.server.on), [false, false]);
  assert.equal(w.b.journal.phase, "back");
  assert.deepEqual(w.b.journal.elsewhere, { name: "MacBook Air", since: frozenAt });
  assert.deepEqual(w.b.home.view(), { phase: "back", elsewhere: { name: "MacBook Air", since: frozenAt } });
  assert.deepEqual(w.b.opened, ["cloud", "local"], "its window opens this computer's copy");
  assert.deepEqual([w.b.brought, w.admin.exportAsks.b, w.b.restarted, w.b.phoneStarts], [0, 0, 0, 0], "nothing is taken from My Cloud, and nothing starts");
  assert.equal(w.b.home.away(), false);

  // The computer the Admin names: exactly what one computer alone does.
  await w.a.home.kick();
  assert.deepEqual(w.a.server.thaws, [null], "lifted as it was, as one computer alone is");
  assert.equal(w.a.phoneStarts, 1);
  assert.equal(w.a.journal.phase, "back");
  assert.equal(w.a.restarted, 1, "the app opens again to finish the restore");
  await w.a.relaunch().kick();
  assert.deepEqual(w.a.live(), ["routine:a1", "routine:b1", "routine:c1", "webhook:bw"], "everything comes home here, with what was on at My Cloud on");
  assert.deepEqual(w.a.home.view(), { phase: "back" });
  assert.deepEqual(w.admin.exportAsks, { a: 1, b: 0 });

  assert.deepEqual({ writes: w.a.journalWrites, thaws: w.a.server.thaws, calls: w.a.localCalls, opened: w.a.opened, phone: w.a.phoneStarts, restarted: w.a.restarted, view: w.a.home.view() },
    await alone(), "write for write and call for call what one computer alone does");

  assert.deepEqual(runsOnBoth(w), [], "an automation never runs on both computers");
  // Later looks change nothing on either.
  for (const desk of [w.b, w.a]) await desk.relaunch().kick();
  assert.deepEqual([w.b.server.thaws.length, w.b.brought, w.admin.exportAsks.b], [1, 0, 0]);
  assert.deepEqual(w.b.live(), []);
  // The line closes as the others do.
  w.b.home.seen();
  assert.equal(w.b.home.view(), null);
});

test("a computer with no answer from the Admin waits and asks again: it never takes itself for the one things come home to", async () => {
  const w = desks();
  await w.moved();
  w.admin.ended = true;
  w.admin.answers = false;
  for (let look = 0; look < 3; look++) { w.advance(60_000); await w.tick(w.b); }
  assert.deepEqual([w.b.server.frozen, w.b.server.thaws, w.b.brought, w.b.journal.phase], [true, [], 0, "done"]);
  // An Admin that has not named one yet says the Cloud is still there: nothing moves either.
  w.admin.answers = true;
  w.admin.ended = false;
  await w.b.home.kick();
  assert.deepEqual([w.b.server.frozen, w.b.brought], [true, 0]);
  // Its answer arrives: another computer.
  w.admin.ended = true;
  await w.b.home.kick();
  assert.deepEqual([w.b.server.thaws, w.b.brought, w.b.journal.phase], [[{ automations: "off" }], 0, "back"]);
});

test("the app killed as its copy opens: it opens it again with every automation off, and never brings anything", async () => {
  const w = desks();
  await w.moved();
  w.admin.ended = true;
  w.b.crashOn = (value) => value?.phase === "back";
  await w.b.home.kick().catch(() => {});
  assert.equal(w.b.journal.phase, "done", "killed before the journal said so");
  await w.b.relaunch().kick();
  assert.deepEqual(w.b.server.thaws, [{ automations: "off" }, { automations: "off" }]);
  assert.equal(w.b.journal.phase, "back");
  assert.deepEqual([w.b.live(), w.b.brought], [[], 0]);
});

test("a computer already coming home when the Admin names another stops asking for My Cloud's backup and switches its automations off", async () => {
  const w = desks();
  await w.moved();
  // It started coming home before the Admin named a computer (an Admin before this one), and is waiting for the export.
  w.admin.homecoming = null;
  w.admin.starting = true;
  w.admin.ended = true;
  const refusing = w.b;
  await refusing.home.kick();
  assert.equal(refusing.journal.phase, "home-again");
  assert.deepEqual(refusing.server.thaws, [null]);
  assert.deepEqual(refusing.live(), ["routine:b1", "webhook:bw"], "home again as it was, as one computer alone is");
  // Now the Admin names the other computer.
  w.admin.homecoming = "a";
  w.admin.starting = false;
  const asked = refusing.brought;
  w.advance(10 * 60_000);
  await w.tick(refusing);
  assert.equal(refusing.journal.phase, "back");
  assert.deepEqual(refusing.journal.elsewhere?.name, "MacBook Air");
  assert.deepEqual(refusing.server.thaws, [null, { automations: "off" }]);
  assert.deepEqual(refusing.live(), []);
  w.advance(10 * 60_000);
  await w.tick(refusing);
  assert.equal(refusing.brought, asked, "and asks My Cloud for nothing more");
});

test("the Admin's word, read: which computer things come home to, and whether it is this one; nothing while it can't be asked", () => {
  const state = (extra) => ({ status: "connected", account: { id: "acct-1" }, deviceId: "dev-b", entitlement: { status: "inactive" },
    machine: { status: "stopped", hold: { until: 5, homecoming: { deviceId: "dev-a", name: "MacBook Air" } } }, ...extra });
  assert.deepEqual(oneHomeCloud(state()).homecoming, { name: "MacBook Air", here: false });
  assert.equal(oneHomeCloud(state()).ended, true);
  assert.deepEqual(oneHomeCloud(state({ deviceId: "dev-a" })).homecoming, { name: "MacBook Air", here: true });
  assert.equal("homecoming" in oneHomeCloud(state({ machine: { status: "stopped", hold: { until: 5 } } })), false, "an Admin that names none");
  const offline = oneHomeCloud(state({ status: "unavailable" }));
  assert.deepEqual([offline.ended, "homecoming" in offline], [false, false], "with no answer from the Admin, no word on either");
});

test("the session's hold names the computer by the Admin's id and name; a malformed one is no name at all", () => {
  const hold = (homecoming) => parseCloudSummary({ state: "stopped", hold: { until: 5, homecoming } })?.hold;
  assert.deepEqual(hold({ deviceId: "54c992f1-0c34-4c4b-9948-08383fd50266", name: " MacBook Air " }), { until: 5, homecoming: { deviceId: "54c992f1-0c34-4c4b-9948-08383fd50266", name: "MacBook Air" } });
  for (const bad of [null, "dev-a", { deviceId: "dev-a" }, { deviceId: "dev a", name: "Mac" }, { deviceId: "dev-a", name: "" }, { deviceId: "dev-a", name: "Mac\u0007" }, { deviceId: "dev-a", name: "x".repeat(101) }]) {
    assert.deepEqual(hold(bad), { until: 5 }, JSON.stringify(bad));
  }
});
