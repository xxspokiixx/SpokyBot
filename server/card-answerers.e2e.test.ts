// Who may answer a card on a workspace several people share, and the record
// of who did. The real server runs against the fake ACP CLI in "permission"
// mode (every turn asks to run `echo hi`), with an email sign-in list naming
// one admin and two members, whose sessions are issued before boot.
//
//   1. a member may answer a card for a request they sent; another member
//      may not, on either respond route
//   2. a member may answer any card on a thread they started
//   3. an admin, and the owner on this machine, may answer any card
//   4. the decision row and the card both name who answered
//   5. with service loopback trust, a session-less local caller (the Slack
//      worker) may decline a card but never approve one
//
// No new card, prompt or gate appears anywhere: the provider's own approval
// is the card, and these only decide whose answer it accepts.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DecisionRow } from "./decision-log.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const BOB = "bob@example.test";

let child: ChildProcess;
let home: string;
let log = "";
const tokens: Record<string, string> = {};
const sessionIds: Record<string, string> = {};

const api = async (method: string, path: string, body?: unknown, as?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function start(env: NodeJS.ProcessEnv = {}) {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1), ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const openCard = (threadId: string) => waitFor(async () => {
  const { body } = await api("GET", `/api/threads/${threadId}/messages`, undefined, BOSS);
  return (body.messages ?? []).find((m: any) => m.kind === "options" && m.card?.requestId && !m.card.answered) ?? null;
});
const settledCard = (threadId: string, requestId: string) => waitFor(async () => {
  const { body } = await api("GET", `/api/threads/${threadId}/messages`, undefined, BOSS);
  return (body.messages ?? []).find((m: any) => m.card?.requestId === requestId && m.card.answeredBy) ?? null;
});
const decision = (requestId: string, kind: DecisionRow["decision"]) => waitFor(async () => {
  const { body } = await api("GET", "/api/decisions", undefined, BOSS);
  return ((body.decisions ?? []) as DecisionRow[]).find((row) => row.requestId === requestId && row.decision === kind) ?? null;
});

async function makeBot(name: string) {
  const created = await api("POST", "/api/bots", { name }, BOSS);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" } }, BOSS);
  expect(patched.status).toBe(200);
  return created.body.bot as { id: string; threadId: string };
}

async function cardFrom(bot: { id: string }, threadId: string, sender?: string) {
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId }, sender);
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const card = await openCard(threadId);
  expect(card, `no approval card appeared:\n${log.slice(-2_000)}`).not.toBeNull();
  return card.card.requestId as string;
}

const refusal = /Only the person who started this conversation or sent this request, or a workspace admin/;

posixOnly("who may answer a card on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-card-answerers-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: { grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA, BOB]) {
      const issued = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] });
      tokens[email] = issued.token;
      sessionIds[email] = issued.session.id;
    }
    registry.close(); // a clean close keeps account sessions across the server's boot
    await start();
  }, 40_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("lets the member who sent the request answer it, and no other member", async () => {
    const bot = await makeBot("Requested");
    const requestId = await cardFrom(bot, bot.threadId, ADA);

    for (const [path, body] of [
      [`/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }],
      [`/api/threads/${bot.threadId}/respond`, { requestId, behavior: "deny" }],
      [`/api/bots/${bot.id}/respond`, { requestId, behavior: "allow", threadId: bot.threadId }],
    ] as const) {
      const refused = await api("POST", path, body, BOB);
      expect(refused.status, path).toBe(403);
      expect(refused.body.error).toMatch(refusal);
    }
    expect((await openCard(bot.threadId))?.card.requestId).toBe(requestId); // still open

    const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }, ADA);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect(answered.body.outcome).not.toBe("unavailable");
    const row = await decision(requestId, "user-approved");
    expect(row?.actor).toEqual({ kind: "session", sessionId: sessionIds[ADA], label: "ada's laptop", email: ADA });
    expect((await settledCard(bot.threadId, requestId))?.card.answeredBy).toEqual({ kind: "session", name: ADA });
  }, 90_000);

  it("lets a member answer any card on a thread they started", async () => {
    const bot = await makeBot("Started");
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Bob's thread" }, BOB);
    expect(task.status).toBe(201);
    const threadId = task.body.task.threadId as string;
    expect(task.body.task.startedBy).toBeUndefined(); // server-private
    const requestId = await cardFrom(bot, threadId, ADA);
    // Ada sent it, Bob started the thread: both may answer; here Bob declines.
    const answered = await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "deny", threadId }, BOB);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await decision(requestId, "user-denied"))?.actor).toMatchObject({ kind: "session", email: BOB });
  }, 90_000);

  it("lets an admin and the owner on this machine answer anyone's card", async () => {
    const bot = await makeBot("Anyone");
    const first = await cardFrom(bot, bot.threadId, ADA);
    expect((await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: first, behavior: "allow" }, BOSS)).status).toBe(200);
    expect((await decision(first, "user-approved"))?.actor).toMatchObject({ kind: "session", email: BOSS });
    expect((await settledCard(bot.threadId, first))?.card.answeredBy).toEqual({ kind: "session", name: BOSS });

    const second = await cardFrom(bot, bot.threadId, BOB);
    expect((await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: second, behavior: "deny" })).status).toBe(200);
    expect((await decision(second, "user-denied"))?.actor).toEqual({ kind: "loopback" });
    expect((await settledCard(bot.threadId, second))?.card.answeredBy).toEqual({ kind: "loopback" });
  }, 90_000);

  it("lets a session-less local service decline but never approve under service trust", async () => {
    const bot = await makeBot("Serviced");
    await waitForExit(child, { signal: "SIGTERM" });
    await start({ OMB_LOOPBACK_TRUST: "service" });
    expect(log).toContain("local requests: service trust (OMB_LOOPBACK_TRUST)");
    const requestId = await cardFrom(bot, bot.threadId, ADA);

    const approve = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" });
    expect(approve.status).toBe(403);
    expect(approve.body.error).toMatch(/can only decline/);
    // The bot-scoped route and the standing grant are not service routes at all.
    expect((await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "allow" })).status).toBe(403);
    expect((await api("POST", `/api/bots/${bot.id}/always-allow`, { allowKey: "shell:echo" })).status).toBe(403);
    expect((await openCard(bot.threadId))?.card.requestId).toBe(requestId);

    const decline = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "deny" });
    expect(decline.status, JSON.stringify(decline.body)).toBe(200);
    expect((await decision(requestId, "user-denied"))?.actor).toEqual({ kind: "worker" });
    expect((await settledCard(bot.threadId, requestId))?.card.answeredBy).toEqual({ kind: "worker" });
  }, 90_000);
});
