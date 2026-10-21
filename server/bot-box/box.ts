// The bot box runtime: one per server. Decides once at boot whether turns are boxed (detect.ts), opens the two gates the
// boxes reach through unix sockets (egress-gate.ts, harness-gate.ts), and wraps each bot spawn (server/procs.ts spawnCli
// with owner "bot") in bubblewrap by the plan (plan.ts). Nothing here changes a spawn when the box is off: the command,
// its arguments and its environment go through untouched, so every host that is not a Cloud home behaves as before.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { SERVER_ROOT, resolveProxy } from "../proxy-paths.ts";
import { bridgedCommand, type BridgeTools } from "./bridge.ts";
import { detectBox, type BoxDetection, type BoxKind } from "./detect.ts";
import { openBoxEgressGate, type BoxEgressGate } from "./egress-gate.ts";
import { boxEnvironment } from "./env.ts";
import { openHarnessGate, type HarnessGate } from "./harness-gate.ts";
import { bwrapArgs, planBox, type BoxBridge, type BoxPlan, type BoxRequest, type BoxSetup } from "./plan.ts";

/** The loopback port inside a box that reaches the egress gate. The harness gate sits at the server's own port. */
export const BOX_EGRESS_PORT = 3128;
export const BOX_BRIDGE_SCRIPT = resolveProxy("bot-box/box-bridge");
export const BOX_PROBE_SCRIPT = resolveProxy("bot-box/box-probe");

export interface WrappedSpawn {
  command: string;
  args: string[];
  env: Record<string, string>;
  plan: BoxPlan;
}

export interface RunnerOptions {
  bwrap: string;
  bridge: BridgeTools;
  setup: BoxSetup;
  /** Names refused in the box's environment whatever the allow-list says: the workspace credentials. */
  denyEnv: ReadonlySet<string>;
  egressPort?: number;
}

/** Wraps spawns for one setup (the server's, or a self-check fixture's). */
export class BoxRunner {
  private readonly options: RunnerOptions;

  constructor(options: RunnerOptions) { this.options = options; }

  get setup(): BoxSetup { return this.options.setup; }

  wrap(request: BoxRequest): WrappedSpawn {
    const plan = planBox(this.options.setup, request);
    const mutate = this.options.setup.mutate;
    const env = mutate?.has("env-all")
      ? Object.fromEntries(Object.entries(request.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
      : boxEnvironment(request.env, this.options.denyEnv);
    if (plan.net === "isolated") {
      const proxy = `http://127.0.0.1:${this.options.egressPort ?? BOX_EGRESS_PORT}`;
      for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) env[name] = proxy;
      // Node's env proxy matches an IPv6 host only bracketed; curl and the engines take the plain forms.
      for (const name of ["NO_PROXY", "no_proxy"]) env[name] = "127.0.0.1,localhost,::1,[::1]";
    }
    const bridges = plan.net === "isolated" ? this.options.setup.bridges : [];
    const inner = bridgedCommand(this.options.bridge, bridges, request.command, request.args);
    return { command: this.options.bwrap, args: [...bwrapArgs(plan), "--", inner.command, ...inner.args], env, plan };
  }
}

export interface BoxChecks { passed: number; total: number; failed: string[]; at: number }

export interface BoxReport {
  box: BoxKind;
  reason: BoxDetection["reason"];
  /** The last self-check (box-probe.ts inside a real box): `passed/total`, null before it ran. */
  checks: BoxChecks | null;
  bridge: "socat" | "node" | null;
  /** Spawns boxed since boot, and what the gates refused. */
  boxed: number;
  refused: { egress: number; harness: number };
}

export interface StartOptions {
  dataDir: string;
  home: string;
  /** The server's loopback port: the harness gate forwards /api/internal/ there. */
  port: number;
  env?: Record<string, string | undefined>;
  denyEnv: ReadonlySet<string>;
  codeRoots?: readonly string[];
  log?: (line: string) => void;
  /** Overrides for tests. */
  detect?: (env: Record<string, string | undefined>) => BoxDetection;
}

export function defaultCodeRoots(): string[] {
  const roots = [dirname(SERVER_ROOT)];
  const node = dirname(dirname(process.execPath));
  if (!roots.some((root) => node.startsWith(root))) roots.push(node);
  return roots;
}

export class BotBox {
  private detection: BoxDetection = { box: "off", reason: "not-cloud", tools: null };
  private runner: BoxRunner | null = null;
  private egress: BoxEgressGate | null = null;
  private harness: HarnessGate | null = null;
  private checks: BoxChecks | null = null;
  private boxed = 0;
  private started: StartOptions | null = null;

  /** Detects, and when the box is on opens the gates. Safe to call once; returns what it decided. */
  async start(options: StartOptions): Promise<BoxDetection> {
    this.started = options;
    const env = options.env ?? process.env;
    this.detection = (options.detect ?? ((e) => detectBox({ env: e })))(env);
    const log = options.log ?? ((line: string) => console.log(line));
    if (this.detection.box !== "bwrap" || !this.detection.tools) {
      log(`bot box: off (${this.detection.reason})`);
      return this.detection;
    }
    const dir = join(options.dataDir, "box");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const egressSocket = join(dir, "egress.sock"), harnessSocket = join(dir, "harness.sock");
    for (const socket of [egressSocket, harnessSocket]) rmSync(socket, { force: true });
    this.egress = await openBoxEgressGate({ socketPath: egressSocket });
    this.harness = await openHarnessGate({ socketPath: harnessSocket, port: options.port });
    const bridges: BoxBridge[] = [
      { name: "egress", port: BOX_EGRESS_PORT, socket: egressSocket },
      { name: "harness", port: options.port, socket: harnessSocket },
    ];
    this.runner = new BoxRunner({
      bwrap: this.detection.tools.bwrap,
      bridge: { socat: this.detection.tools.socat, bridgeScript: BOX_BRIDGE_SCRIPT, node: process.execPath },
      setup: { dataDir: options.dataDir, home: options.home, codeRoots: options.codeRoots ?? defaultCodeRoots(), bridges },
      denyEnv: options.denyEnv,
    });
    log(`bot box: on (bubblewrap, ${this.detection.tools.socat ? "socat" : "node"} bridges)`);
    return this.detection;
  }

  /** The box for one spawn, or null when turns are not boxed here. */
  wrap(request: BoxRequest): WrappedSpawn | null {
    if (!this.runner) return null;
    const wrapped = this.runner.wrap(request);
    this.boxed += 1;
    return wrapped;
  }

  enabled(): boolean { return this.runner !== null; }

  tools(): { bwrap: string; socat: string | null } | null { return this.detection.tools; }

  noteChecks(checks: BoxChecks): void { this.checks = checks; }

  report(): BoxReport {
    return {
      box: this.detection.box,
      reason: this.detection.reason,
      checks: this.checks,
      bridge: this.detection.tools ? (this.detection.tools.socat ? "socat" : "node") : null,
      boxed: this.boxed,
      refused: { egress: this.egress?.refused ?? 0, harness: this.harness?.refused ?? 0 },
    };
  }

  startOptions(): StartOptions | null { return this.started; }

  async stop(): Promise<void> {
    await Promise.all([this.egress?.close(), this.harness?.close()]);
    this.egress = null;
    this.harness = null;
    this.runner = null;
  }
}

export const botBox = new BotBox();
