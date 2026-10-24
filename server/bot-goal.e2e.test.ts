// POSIX-gated like the other CLI e2es: the fakes are shebang scripts.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const MARKER = (status: string, detail: string) => `<openmaus-goal>{"status":"${status}","detail":"${detail}"}</openmaus-goal>`;
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("bot goal e2e", () => {
  let child: ChildProcess;
  let home: string;
  let stderr = "";
  let promptsFile: string;
  let slowGate: string;

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const goalOf = async (bot: any) => (await getBot(bot.id)).tasks.find((task: any) => task.threadId === bot.threadId)?.goal;
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const prompts = () => {
    try { return readFileSync(promptsFile, "utf8").split("\n").filter(Boolean); } catch { return []; }
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-goal-"));
    mkdirSync(join(home, ".openmausbot"), { recursive: true });
    promptsFile = join(home, "prompts.jsonl");
    slowGate = join(home, "slow.gate");
    const replies = ["started on it", "making progress", `all tests pass\n${MARKER("completed", "suite is green")}`];
    writeFileSync(
      join(home, ".openmausbot", "config.json"),
      JSON.stringify({
        instances: {
          scripted: {
            driver: "claudeAgent",
            environment: { FAKE_CLAUDE_REPLIES: JSON.stringify(replies), FAKE_CLAUDE_REPLY_STATE: join(home, "replies.state"), FAKE_CLAUDE_PROMPTS: promptsFile },
            config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
          },
          failing: {
            driver: "claudeAgent",
            environment: { FAKE_CLAUDE_MODE: "api-error", FAKE_CLAUDE_PROMPTS: join(home, "failing-prompts.jsonl") },
            config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
          },
          slow: {
            driver: "claudeAgent",
            environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: slowGate },
            config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
          },
        },
      }),
    );
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, OMB_PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    rmSync(home, { recursive: true, force: true });
  });

  it("works across turns until the bot reports the goal done, without showing the marker or a fake person line", async () => {
    const created = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${created.id}`, { modelSelection: { instanceId: "scripted", model: "claude-fake" } });
    const set = await api("POST", `/api/bots/${created.id}/goal`, { threadId: created.threadId, action: "set", text: "get all tests passing" });
    expect(set.status).toBe(200);
    expect(set.body.goal).toMatchObject({ status: "active", text: "get all tests passing" });

    await waitFor(async () => (await goalOf(created))?.status === "complete", "the goal to complete");
    expect(await goalOf(created)).toMatchObject({ status: "complete", turns: 3, detail: "suite is green" });
    expect(prompts()).toHaveLength(3);
    expect(prompts()[0]).toContain("get all tests passing");
    expect(prompts()[2]).toContain("goal turn 3 of at most 10");

    const bot = await getBot(created.id);
    const texts = bot.messages.filter((m: any) => m.kind === "text");
    expect(texts.every((m: any) => m.role === "bot")).toBe(true);
    expect(texts.map((m: any) => m.text).join("\n")).not.toContain("openmaus-goal");
    expect(texts.at(-1).text).toContain("all tests pass");
  }, 60_000);

  it("Stop pauses the goal and nothing continues after the interrupted turn settles", async () => {
    rmSync(slowGate, { force: true });
    const created = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${created.id}`, { modelSelection: { instanceId: "slow", model: "claude-fake" } });
    expect((await api("POST", `/api/bots/${created.id}/goal`, { threadId: created.threadId, action: "set", text: "keep going" })).status).toBe(200);
    await waitFor(async () => (await getBot(created.id)).busy === true, "the goal turn to start");

    expect((await api("POST", `/api/bots/${created.id}/interrupt`, { threadId: created.threadId })).status).toBe(200);
    await waitFor(async () => (await getBot(created.id)).busy === false, "the turn to settle");
    expect(await goalOf(created)).toMatchObject({ status: "paused", reason: "stopped", turns: 1 });
    expect((await getBot(created.id)).busy).toBe(false);
  }, 60_000);

  it("a failed turn pauses the goal instead of continuing", async () => {
    const created = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${created.id}`, { modelSelection: { instanceId: "failing", model: "claude-fake" } });
    expect((await api("POST", `/api/bots/${created.id}/goal`, { threadId: created.threadId, action: "set", text: "never works" })).status).toBe(200);
    await waitFor(async () => (await goalOf(created))?.status === "paused", "the goal to pause");
    await waitFor(async () => (await getBot(created.id)).busy === false, "the turn to settle");
    expect(await goalOf(created)).toMatchObject({ status: "paused", reason: "failed", turns: 1 });
    expect(readFileSync(join(home, "failing-prompts.jsonl"), "utf8").split("\n").filter(Boolean)).toHaveLength(1);
  }, 60_000);

  it("refuses a goal for a conversation that is not this bot's and an unknown action", async () => {
    const created = (await api("POST", "/api/bots")).body.bot;
    expect((await api("POST", `/api/bots/${created.id}/goal`, { threadId: "nope", action: "set", text: "x" })).status).toBe(404);
    expect((await api("POST", `/api/bots/${created.id}/goal`, { threadId: created.threadId, action: "launch" })).status).toBe(400);
    expect((await api("POST", `/api/bots/${created.id}/goal`, { threadId: created.threadId, action: "set", text: "  " })).status).toBe(409);
  }, 30_000);
});
