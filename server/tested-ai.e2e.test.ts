// Real server, two fake Claude accounts: the first one's test message gets no answer. The new-bot default and the
// first bot move to the one that answered; a saved default is never tested or moved.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { verificationServerEnvironment } from "../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_CLI = join(ROOT, "server/testing/fake-claude-cli.ts");

const homes: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) await waitForExit(child, { signal: "SIGTERM" });
  for (const home of homes.splice(0)) await removeTempDir(home);
});

/** `claude` never answers a one-shot (its reply file is missing); `spare` answers every one. */
async function boot(extra: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), "omb-tested-ai-"));
  homes.push(home);
  mkdirSync(join(home, "tmp"), { recursive: true });
  mkdirSync(join(home, "spare-claude"), { recursive: true });
  const checks = (instance: string) => join(home, `${instance}-checks.jsonl`);
  writeFileSync(join(home, "config.json"), JSON.stringify({
    instances: {
      claude: { driver: "claudeAgent", displayName: "Silent Claude", config: { cli: FAKE_CLI },
        environment: { FAKE_CLAUDE_TEXT_FILE: join(home, "no-reply"), FAKE_CLAUDE_TEXT_LOG: checks("claude") } },
      spare: { driver: "claudeAgent", displayName: "Spare Claude", config: { cli: FAKE_CLI, configDir: join(home, "spare-claude") },
        environment: { FAKE_CLAUDE_TEXT_LOG: checks("spare") } },
    },
    ...extra,
  }));
  const port = await freePortBlock([0, 1]);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server/index.ts")], {
    cwd: ROOT,
    // Background test messages are off in test fixtures unless asked for.
    env: { ...verificationServerEnvironment(process.env, home, port), OMB_AI_CHECKS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error(`server exited during boot:\n${output}`);
    try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
  }, { timeout: 20_000, interval: 50 }).toBe(true);
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method, headers: { origin: base, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${method} ${path}`).toBe(true);
    return response.json() as Promise<any>;
  };
  const sent = (instance: string) => existsSync(checks(instance))
    ? readFileSync(checks(instance), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line).prompt as string) : [];
  const tests = async () => Object.fromEntries(((await api("GET", "/api/instances")).instances as Array<{ instanceId: string; aiTest?: string }>)
    .filter((instance) => instance.instanceId === "claude" || instance.instanceId === "spare")
    .map((instance) => [instance.instanceId, instance.aiTest ?? null]));
  const starter = async () => ((await api("GET", "/api/bots?messages=0")).bots as Array<{ chiefOfStaff?: boolean; modelSelection: { instanceId: string } }>)
    .find((bot) => bot.chiefOfStaff)!;
  return { api, sent, tests, starter };
}

it("moves the new-bot default and the untouched first bot off an AI whose test message got no answer", async () => {
  const server = await boot();
  await expect.poll(server.tests, { timeout: 30_000, interval: 250 }).toEqual({ claude: "failed", spare: "passed" });
  expect(server.sent("claude")).toEqual(["This is a connection check. Reply with the single word OK."]);
  expect(server.sent("spare")).toHaveLength(1);
  await expect.poll(async () => (await server.starter()).modelSelection.instanceId, { timeout: 10_000 }).toBe("spare");
  const made = await server.api("POST", "/api/bots", { name: "Made after the test" });
  expect(made.bot.modelSelection.instanceId).toBe("spare");
}, 60_000);

it("never tests or moves a saved default", async () => {
  const server = await boot({ defaultModelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(await server.tests()).toEqual({ claude: null, spare: null });
  expect(server.sent("claude")).toEqual([]);
  expect((await server.starter()).modelSelection.instanceId).toBe("claude");
}, 60_000);
