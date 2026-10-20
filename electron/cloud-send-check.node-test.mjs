import assert from "node:assert/strict";
import test from "node:test";

import { checkChats, checkSecrets, manifestGaps, missingAttachments, noGaps } from "./cloud-send-check.mjs";

const manifest = (extra = {}) => ({
  v: 1, appVersion: "0.1.120",
  items: [
    { key: "bot:ember", kind: "bot", label: "Ember", id: "ember", parts: { soul: "s1", team: "t1" } },
    { key: "skill:ember:notes", kind: "skill", label: "notes", id: "notes", bot: "ember", parts: { text: "n1", on: "on" } },
    { key: "login:example.test|alice", kind: "login", label: "example.test", parts: { saved: "1" } },
    { key: "bot:juno", kind: "bot", label: "Juno", id: "juno", parts: { soul: "j1" } },
  ],
  memory: [{ bot: "ember", path: "MEMORY.md", hash: "m1" }],
  rooms: [{ id: "r1", name: "Launch", members: ["ember"], threads: ["t-room"] }],
  connections: ["key:openrouter", "mcp:docs"],
  conversations: [{ threadId: "t-ember", bot: "ember", rows: 4, newest: "e4" }, { threadId: "t-juno", bot: "juno", rows: 1, newest: "j1" }, { threadId: "t-room", room: "r1", rows: 2, newest: "r2" }],
  attachments: [],
  ...extra,
});

test("a move's check finds nothing missing when My Cloud holds all this computer sent, its own way of holding a part included", () => {
  const here = manifest();
  const there = manifest({ items: here.items.map((item) => item.key === "bot:ember" ? { ...item, parts: { soul: "s1", team: "t9" } }
    : item.kind === "login" ? { ...item, parts: { saved: "7" } } : item) });
  const sent = { "bot:ember": { team: ["t1", "t9"] } };
  assert.equal(noGaps(manifestGaps(here, there, { sent })), true, "My Cloud's own hash for what it took is in step");
  assert.deepEqual(manifestGaps(here, there).parts, [{ key: "bot:ember", label: "Ember", parts: ["team"] }], "the same part never recorded as taken is not");
});

test("a move's check names what My Cloud lacks: items, parts, memory, rooms, connections and conversations, leaving out what was removed there", () => {
  const here = manifest();
  const there = manifest({ items: here.items.filter((item) => item.key !== "skill:ember:notes" && item.key !== "bot:juno").map((item) => item.key === "bot:ember" ? { ...item, parts: { soul: "s2", team: "t1" } } : item),
    memory: [], rooms: [], connections: ["key:openrouter"], conversations: [] });
  assert.deepEqual(manifestGaps(here, there), {
    items: [{ key: "skill:ember:notes", kind: "skill", label: "notes" }, { key: "bot:juno", kind: "bot", label: "Juno" }],
    parts: [{ key: "bot:ember", label: "Ember", parts: ["soul"] }],
    memory: [{ bot: "ember", path: "MEMORY.md" }],
    rooms: [{ id: "r1", name: "Launch" }],
    connections: ["mcp:docs"],
    conversations: ["t-ember", "t-juno", "t-room"],
  });
  const removed = new Set(["bot:juno", "t-room", "room:r1"]);
  const gaps = manifestGaps(here, there, { removed, skip: new Set(["mcp:docs", "skill:ember:notes"]) });
  assert.deepEqual([gaps.items, gaps.rooms, gaps.connections, gaps.conversations], [[], [], [], ["t-ember"]], "a bot removed there takes its conversations with it");
  assert.equal(manifestGaps(null, there), null);
});

/** This computer's rows and path for `thread`, and a My Cloud that checks them against its own `cloudPath`/`cloudRows`. */
function chatsSides({ rows, path, cloudRows = rows, cloudPath = path }) {
  const asked = [];
  const localJson = async (route) => {
    const from = Number(/from=(\d+)/u.exec(route)[1]);
    return { v: 1, ids: rows.slice(from, from + 5_000), path: path.slice(from, from + 5_000), leaf: path.at(-1), more: from + 5_000 < Math.max(rows.length, path.length) };
  };
  const session = {
    call: async (_method, _route, body) => {
      asked.push(body.conversations[0]);
      const { threadId, ids, path: chunk } = body.conversations[0];
      let at = chunk?.after ? cloudPath.indexOf(chunk.after) + 1 : 0, holds = true, last = chunk?.after ?? null;
      for (const id of chunk?.ids ?? []) { const found = cloudPath.indexOf(id, at); if (found < 0) { holds = false; break; } at = found + 1; last = id; }
      return { ok: true, status: 200, body: { v: 1, conversations: [{ threadId, missing: ids.filter((id) => !cloudRows.includes(id)),
        ...(chunk ? { path: { holds, at: last, ...(chunk.last ? { leaf: cloudPath.at(-1), length: cloudPath.length } : {}) } } : {}) }] } };
    },
  };
  return { localJson, session, asked };
}

test("each conversation's check says the rows My Cloud lacks and whether its path is equal, inside a longer one, or broken", async () => {
  const ids = (count, prefix = "r") => Array.from({ length: count }, (_, i) => `${prefix}${i}`);
  const long = ids(12_001);
  const equal = chatsSides({ rows: long, path: long });
  assert.deepEqual(await checkChats({ localJson: equal.localJson, session: equal.session, threads: ["t-a"] }), [{ threadId: "t-a", missing: 0, path: "equal" }]);
  assert.equal(equal.asked.length, 3, "ids and the path go in chunks of 5,000");
  assert.deepEqual(equal.asked.map((chunk) => chunk.path.after), [null, "r4999", "r9999"]);

  const woven = chatsSides({ rows: ids(4), path: ids(4), cloudRows: [...ids(4), "c1"], cloudPath: ["r0", "r1", "c1", "r2", "r3"] });
  assert.deepEqual(await checkChats({ localJson: woven.localJson, session: woven.session, threads: ["t-b"] }), [{ threadId: "t-b", missing: 0, path: "inside" }]);

  // As the hidden-chat bug left one: every row there, the first turns off the path My Cloud shows.
  const hidden = chatsSides({ rows: ids(6), path: ids(6), cloudPath: ["r3", "r4", "r5"] });
  assert.deepEqual(await checkChats({ localJson: hidden.localJson, session: hidden.session, threads: ["t-c"] }), [{ threadId: "t-c", missing: 0, path: "broken" }]);
  const short = chatsSides({ rows: ids(3), path: ids(3), cloudRows: ["r0"], cloudPath: ["r0"] });
  assert.deepEqual(await checkChats({ localJson: short.localJson, session: short.session, threads: ["t-d"] }), [{ threadId: "t-d", missing: 2, path: "broken" }]);
});

test("the attachments and credentials My Cloud lacks or holds otherwise are named, by name and id only", async () => {
  const names = Array.from({ length: 2_500 }, (_, i) => `${String(i).padStart(8, "0")}.png`);
  const checked = [];
  const session = {
    call: async (_method, route, body) => {
      if (route === "/api/cloud-send/chats/attachments") { checked.push(body.names.length); return { ok: true, status: 200, body: { missing: body.names.filter((name) => name.startsWith("00000001")) } }; }
      return { ok: true, status: 200, body: { v: 1, secrets: { "login:a|b": `h:${body.nonce}`, "key:openrouter": "other", "mcp:gone": "x" } } };
    },
  };
  assert.deepEqual(await missingAttachments(session, names), names.filter((name) => name.startsWith("00000001")));
  assert.deepEqual(checked, [2_000, 500]);
  const handoff = async (what) => ({ secrets: { "login:a|b": `h:${what.nonce}`, "key:openrouter": "mine", "mcp:docs": "d", "1password": "p" } });
  const secrets = await checkSecrets({ handoff, session, skip: new Set(["1password"]) });
  assert.deepEqual(secrets, { equal: ["login:a|b"], differs: ["key:openrouter"], missing: ["mcp:docs"] });
  await assert.rejects(checkSecrets({ handoff: async () => ({}), session }), /could not be checked/u);
});
