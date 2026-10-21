import assert from "node:assert/strict";
import test from "node:test";

import environments from "./environments.cjs";
import { createHomePlaces } from "./home-places.mjs";

const HOME = "https://omb-t-1.fly.dev", TEAM = "https://omb-u-acme.fly.dev", OTHER = "https://omb-u-beta.fly.dev";
const acme = { id: "team-acme", name: "Acme", role: "admin", machine: { status: "ready", origin: TEAM } };
const beta = { id: "team-beta", name: "Beta", role: "member", machine: { status: "ready", origin: OTHER } };
const connected = (teams) => ({ status: "connected", account: { id: "acct-1" }, teams });

function world({ saved = null, state = { environments: [{ id: "c", kind: "remote", name: "My Cloud", origin: HOME, home: true }], activeId: "c" } } = {}) {
  const w = { saved, state, persisted: [], ids: 0, log: [] };
  w.places = createHomePlaces({
    store: { read: () => { if (w.saved === null) throw new Error("ENOENT"); return w.saved; }, write: (value) => { if (w.failWrite) throw new Error("disk full"); w.saved = value; } },
    environments: () => w.state, persist: (next) => { w.persisted.push(next); w.state = next; }, makeId: () => `id-${++w.ids}`, homeOrigin: () => HOME, log: (line) => w.log.push(line),
  });
  return w;
}

test("a connected session's teams become saved places; the remembered team is kept with its name and address, and forgotten once the session drops it, with one line for the next page", () => {
  const w = world();
  assert.equal(w.places.remembered(), null);
  w.places.sync({ status: "unavailable", account: { id: "acct-1" } });
  assert.deepEqual(w.persisted, [], "a check that failed changes nothing");
  w.places.sync(connected([acme, beta]));
  assert.deepEqual(w.state.environments.map((entry) => [entry.name, entry.team?.id ?? null]), [["My Cloud", null], ["Acme", "team-acme"], ["Beta", "team-beta"]]);
  w.places.remember({ team: "team-acme" });
  assert.deepEqual(w.places.remembered(), { team: "team-acme", name: "Acme", origin: TEAM });
  assert.deepEqual(w.saved, { team: "team-acme", told: [] });
  w.places.remember({ team: "team-acme" });
  w.places.sync(connected([acme, beta]));
  assert.equal(w.persisted.length, 1, "the same teams again: nothing written");
  assert.equal(w.places.line(HOME), null, "nothing to say on My Cloud's page");
  // Shown Acme, then dropped from it: Acme is gone from the places, My Cloud is active, the line waits once.
  w.state = { ...w.state, activeId: "id-1" };
  w.places.sync(connected([beta]));
  assert.deepEqual(w.state.environments.map((entry) => entry.name), ["My Cloud", "Beta"]);
  assert.equal(w.state.activeId, "c");
  assert.equal(w.places.remembered(), null, "next launch opens My Cloud");
  assert.deepEqual(w.places.line(HOME), { kind: "left", name: "Acme" });
  assert.equal(w.places.line(HOME), null, "said once");
  w.places.sync(connected([beta]));
  assert.equal(w.places.line(HOME), null, "and not again on the next check");
});

test("a team's first open on this device gets its line once, on that team's page only; a team gone before being told is told nothing", () => {
  const w = world();
  w.places.sync(connected([acme, beta]));
  assert.equal(w.places.line(HOME), null);
  assert.equal(w.places.line("https://evil.example"), null);
  assert.deepEqual(w.places.line(TEAM), { kind: "private", name: "Acme" });
  assert.equal(w.places.line(TEAM), null, "once");
  assert.deepEqual(w.saved, { team: null, told: ["team-acme"] });
  assert.deepEqual(w.places.line(OTHER), { kind: "private", name: "Beta" }, "each team on its own");
  const again = world({ saved: w.saved, state: w.state });
  assert.equal(again.places.line(TEAM), null, "remembered across launches");
  w.places.left("Beta");
  w.places.left("Beta");
  assert.deepEqual(w.places.line(TEAM), { kind: "left", name: "Beta" }, "a team gone comes before anything else, once");
  assert.equal(w.places.line(TEAM), null);
});

test("a remembered team whose place is gone from the file is still remembered by id; a bad file is an empty one; a write that fails is logged, never thrown", () => {
  const w = world({ saved: { team: "team-acme", told: ["x", 7, "y"] } });
  assert.deepEqual(w.places.remembered(), { team: "team-acme" }, "no entry yet: the id alone");
  assert.equal(w.places.line(TEAM), null, "no team entry at that address");
  const bad = world({ saved: "garbage" });
  assert.equal(bad.places.remembered(), null);
  bad.failWrite = true;
  bad.places.remember({ team: "team-acme" });
  assert.equal(bad.log.length, 1);
  assert.deepEqual(bad.places.remembered(), { team: "team-acme" }, "kept in memory for this run");
  assert.equal(environments.reconcileTeams({ environments: [], activeId: "local" }, [], () => "x", HOME).state.activeId, "local");
});
