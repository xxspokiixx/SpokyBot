import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotBox, BoxRunner, BOX_EGRESS_PORT } from "./box.ts";
import { spawnCli } from "../procs.ts";
import { waitForExit } from "../procs.ts";

const bridge = { socat: "/usr/bin/socat", bridgeScript: "/app/dist-server/bot-box/box-bridge.js", node: "/usr/local/bin/node" };

describe("BoxRunner.wrap", () => {
  const setup = { dataDir: "/data/.openmausbot", home: "/data", codeRoots: ["/app"], bridges: [{ name: "egress", port: BOX_EGRESS_PORT, socket: "/data/.openmausbot/box/egress.sock" }, { name: "harness", port: 8799, socket: "/data/.openmausbot/box/harness.sock" }] };

  it("runs the engine under bwrap with the plan, the allow-listed environment and the proxy pointed at the gate", () => {
    const runner = new BoxRunner({ bwrap: "/usr/bin/bwrap", bridge, setup, denyEnv: new Set(["COMPOSIO_API_KEY"]) });
    const wrapped = runner.wrap({
      command: "/usr/local/bin/claude", args: ["-p", "--output-format", "stream-json"], cwd: "/data/.openmausbot/task-workspaces/b1/t1",
      env: { PATH: "/usr/bin", HOME: "/data", ANTHROPIC_API_KEY: "k", COMPOSIO_API_KEY: "c", OMB_CLOUD_BOOTSTRAP_SECRET: "s", RANDOM_SECRET: "r" },
    });
    expect(wrapped.command).toBe("/usr/bin/bwrap");
    expect(wrapped.args.slice(0, 3)).toEqual(["--ro-bind", "/usr", "/usr"]);
    const separator = wrapped.args.indexOf("--");
    expect(wrapped.args.slice(separator + 1, separator + 3)).toEqual(["/bin/sh", "-c"]);
    expect(wrapped.args.slice(-4)).toEqual(["/usr/local/bin/claude", "-p", "--output-format", "stream-json"]);
    expect(wrapped.env).toEqual({
      PATH: "/usr/bin", HOME: "/data", ANTHROPIC_API_KEY: "k",
      HTTPS_PROXY: `http://127.0.0.1:${BOX_EGRESS_PORT}`, HTTP_PROXY: `http://127.0.0.1:${BOX_EGRESS_PORT}`, https_proxy: `http://127.0.0.1:${BOX_EGRESS_PORT}`, http_proxy: `http://127.0.0.1:${BOX_EGRESS_PORT}`,
      NO_PROXY: "127.0.0.1,localhost,::1,[::1]", no_proxy: "127.0.0.1,localhost,::1,[::1]",
    });
    expect(wrapped.plan.botId).toBe("b1");
  });

  it("a shared-network box gets no proxy and no bridge", () => {
    const runner = new BoxRunner({ bwrap: "/usr/bin/bwrap", bridge, setup, denyEnv: new Set() });
    const wrapped = runner.wrap({ command: "/opt/chrome", args: ["--headless"], env: { PATH: "/usr/bin" }, net: "shared" });
    expect(wrapped.env).toEqual({ PATH: "/usr/bin" });
    expect(wrapped.args.slice(wrapped.args.indexOf("--") + 1)).toEqual(["/opt/chrome", "--headless"]);
  });

  it("the env-all mutation hands over the whole environment (so the self-check can prove the allow-list)", () => {
    const runner = new BoxRunner({ bwrap: "/usr/bin/bwrap", bridge, setup: { ...setup, mutate: new Set(["env-all" as const]) }, denyEnv: new Set() });
    expect(runner.wrap({ command: "x", args: [], env: { OMB_CLOUD_BOOTSTRAP_SECRET: "s", EMPTY: undefined } }).env).toMatchObject({ OMB_CLOUD_BOOTSTRAP_SECRET: "s" });
  });
});

describe("BotBox", () => {
  const dirs: string[] = [];
  const boxes: BotBox[] = [];
  afterEach(async () => {
    for (const box of boxes.splice(0)) await box.stop();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const temp = () => { const dir = mkdtempSync(join(tmpdir(), "omb-box-")); dirs.push(dir); return dir; };

  it("off: wraps nothing and reports why", async () => {
    const box = new BotBox();
    boxes.push(box);
    const lines: string[] = [];
    expect((await box.start({ dataDir: temp(), home: temp(), port: 8799, denyEnv: new Set(), env: {}, log: (line) => lines.push(line) })).box).toBe("off");
    expect(box.wrap({ command: "claude", args: [], env: {} })).toBeNull();
    expect(box.report()).toEqual({ box: "off", reason: "not-cloud", checks: null, bridge: null, boxed: 0, refused: { egress: 0, harness: 0 } });
    expect(lines).toEqual(["bot box: off (not-cloud)"]);
    expect(existsSync(join(dirs[0]!, "box"))).toBe(false);
  });

  it("on: opens the two gates under the data folder, wraps every spawn and counts them", async () => {
    const box = new BotBox();
    boxes.push(box);
    const dataDir = temp();
    const lines: string[] = [];
    const detection = await box.start({
      dataDir, home: temp(), port: 8799, denyEnv: new Set(), env: {}, log: (line) => lines.push(line),
      detect: () => ({ box: "bwrap", reason: null, tools: { bwrap: "/usr/bin/bwrap", socat: null } }),
    });
    expect(detection.box).toBe("bwrap");
    expect(existsSync(join(dataDir, "box", "egress.sock"))).toBe(true);
    expect(existsSync(join(dataDir, "box", "harness.sock"))).toBe(true);
    const wrapped = box.wrap({ command: "/usr/bin/codex", args: ["app-server"], env: { PATH: "/usr/bin" } })!;
    expect(wrapped.command).toBe("/usr/bin/bwrap");
    expect(wrapped.args).toContain(join(dataDir, "box", "harness.sock"));
    expect(wrapped.args).toContain("/run/omb/harness.sock");
    expect(box.report()).toMatchObject({ box: "bwrap", bridge: "node", boxed: 1, checks: null });
    box.noteChecks({ passed: 20, total: 21, failed: ["egress-public-allowed"], at: 1 });
    expect(box.report().checks).toEqual({ passed: 20, total: 21, failed: ["egress-public-allowed"], at: 1 });
    expect(lines).toEqual(["bot box: on (bubblewrap, node bridges)"]);
  });
});

describe("spawnCli goes through the box", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    const { botBox } = await import("./box.ts");
    await botBox.stop();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("a bot spawn runs under the box's command; other spawns and box: false do not", async () => {
    const { botBox } = await import("./box.ts");
    const dir = mkdtempSync(join(tmpdir(), "omb-spawn-"));
    dirs.push(dir);
    // A stand-in for bwrap: records its argv, then runs what follows `--`.
    const fakeBwrap = join(dir, "fake-bwrap.sh"), record = join(dir, "argv.txt");
    writeFileSync(fakeBwrap, `#!/bin/sh\nprintf '%s\\n' "$@" > ${record}\nwhile [ "$1" != "--" ]; do shift; done; shift\nexec "$@"\n`);
    chmodSync(fakeBwrap, 0o755);
    await botBox.start({
      dataDir: join(dir, "data"), home: dir, port: 8799, denyEnv: new Set(), env: {}, log: () => {},
      // /usr/bin/true stands in for socat: the shell init starts it, waits once, and execs the engine.
      detect: () => ({ box: "bwrap", reason: null, tools: { bwrap: fakeBwrap, socat: "/usr/bin/true" } }),
    });
    const run = async (owner: "bot" | "openmausbot", box?: false) => {
      rmSync(record, { force: true });
      const child = spawnCli("/bin/sh", ["-c", "echo ran"], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: dir, SECRET_THING: "x" }, box }, owner);
      let out = "";
      child.stdout.on("data", (chunk) => { out += chunk; });
      await waitForExit(child, 10_000);
      return { out: out.trim(), boxed: existsSync(record), argv: existsSync(record) ? readFileSync(record, "utf8") : "" };
    };
    const boxed = await run("bot");
    expect(boxed.boxed).toBe(true);
    expect(boxed.out).toBe("ran");
    expect(boxed.argv).toContain("--unshare-net");
    expect(boxed.argv).toContain("/run/omb/egress.sock");
    expect((await run("openmausbot")).boxed).toBe(false);
    expect((await run("bot", false)).boxed).toBe(false);
    expect(botBox.report().boxed).toBe(1);
  });
});
