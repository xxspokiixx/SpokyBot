import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

import { spawnBotWork } from "../../oom-score.ts";
import { androidGuest, guestInvocation, guestWorkspacePath } from "../../android-guest.ts";
import { pipeTransport, webSocketTransport, type CdpTransport } from "../cdp/transport.ts";
import { chromeArgs, chromeEnv, type ChromeEnvInput, type ChromeFlagsInput } from "./flags.ts";
import { diagnoseLaunchFailure } from "./host-setup.ts";
import type { ProcessRegistry } from "./processes.ts";

export interface LaunchOptions extends ChromeFlagsInput, Omit<ChromeEnvInput, "host"> {
  /** A resolved Chrome or Chrome for Testing executable. */
  executablePath: string;
  env?: NodeJS.ProcessEnv;
  /** A first launch on a fresh machine can take half a minute (font caches, a virus scan of the binary). */
  handshakeTimeoutMs?: number;
  registry?: ProcessRegistry | null;
}

export interface BrowserVersion {
  product: string;
  userAgent: string;
  protocolVersion: string;
  revision: string;
}

export interface ChromeExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ChromeProcess {
  readonly pid: number;
  readonly argv: readonly string[];
  /** The pipe; nothing else can reach this Chrome's DevTools. */
  readonly transport: CdpTransport;
  readonly version: BrowserVersion;
  readonly exited: Promise<ChromeExit>;
  /** The last part of what Chrome printed. */
  output(): string;
  /** Waits for Chrome to exit (after Browser.close), then terminates and finally kills it. */
  close(graceMs?: number): Promise<ChromeExit>;
  kill(): Promise<ChromeExit>;
}

export class ChromeLaunchError extends Error {
  readonly output: string;

  constructor(message: string, output: string) {
    super(message);
    this.name = "ChromeLaunchError";
    this.output = output;
  }
}

const OUTPUT_LIMIT = 64 * 1024;

/** A binary's first start on a machine: Windows scans a newly downloaded Chrome before it runs, over 60 s for Chrome
 * for Testing 156 on GitHub's Windows runner. */
export const FIRST_START_MS = 120_000;
const HANDSHAKE_ID = 0;

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])], { windowsHide: true }, () => {});
    return;
  }
  try { child.kill(signal); } catch {}
}

/** Browser.getVersion over the fresh pipe: the first answer proves the pipe works. */
function handshake(transport: CdpTransport, exited: Promise<ChromeExit>, timeoutMs: number): Promise<BrowserVersion> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error: Error | null, version?: BrowserVersion) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(version!);
    };
    transport.onMessage((text) => {
      if (done || !text.startsWith(`{"id":${HANDSHAKE_ID},`)) return;
      try {
        const message = JSON.parse(text) as { id?: number; result?: BrowserVersion; error?: { message?: string } };
        if (message.id !== HANDSHAKE_ID) return;
        if (message.error || !message.result) finish(new Error(`Chrome refused its DevTools pipe: ${message.error?.message ?? "no answer"}`));
        else finish(null, message.result);
      } catch {}
    });
    transport.onClose((reason) => finish(new Error(`Chrome closed its DevTools pipe before answering (${reason}).`)));
    void exited.then((exit) => finish(new Error(`Chrome exited before answering (${exit.signal ?? `code ${exit.code}`}).`)));
    const timer = setTimeout(() => finish(new Error(`Chrome did not answer on its DevTools pipe within ${timeoutMs} ms.`)), timeoutMs);
    transport.send(JSON.stringify({ id: HANDSHAKE_ID, method: "Browser.getVersion", params: {} }));
  });
}

/** Chrome on the phone reports its DevTools endpoint in the profile folder, since proot cannot carry the pipe's
 *  extra descriptors. The first line is the port, the second the browser target's path. */
async function devToolsPortTransport(userDataDir: string, exited: Promise<ChromeExit>, timeoutMs: number): Promise<CdpTransport> {
  const file = join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const [port, path] = readFileSync(file, "utf8").split("\n");
      const number = Number(port);
      if (Number.isInteger(number) && number > 0 && path?.trim()) {
        return await webSocketTransport(`ws://127.0.0.1:${number}${path.trim()}`);
      }
    } catch {
      // Not written yet: Chrome creates the file once its DevTools listener is up.
    }
    if (Date.now() > deadline) throw new Error("Chrome did not open its DevTools port in time.");
    await Promise.race([
      exited.then((exit) => { throw new Error(`Chrome exited before opening its DevTools port (${exit.signal ?? `code ${exit.code}`}).`); }),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]);
  }
}
export async function launchChrome(options: LaunchOptions): Promise<ChromeProcess> {
  // On the phone the browser is the guest's own Chromium, reached through proot: the wrapper cannot
  // carry the extra descriptors Chrome's DevTools pipe rides on, so the launch names a loopback port
  // instead, and the profile is addressed by the guest's name for it.
  const phone = androidGuest(options.env ?? process.env);
  const profileDir = phone ? guestWorkspacePath(options.userDataDir, options.env ?? process.env) : options.userDataDir;
  const argv = chromeArgs({ ...options, userDataDir: profileDir });
  const env = chromeEnv(options.env ?? process.env, {
    host: options.host,
    timezone: options.timezone ?? null,
    sandboxHelper: options.sandboxHelper ?? null,
    profileMarker: options.profileMarker ?? null,
  });
  const launch = guestInvocation(options.executablePath, argv, options.env ?? process.env);
  const child = spawnBotWork(() => spawn(launch.command, launch.args, { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"], env: launch.env, windowsHide: true }));
  let output = "";
  const keep = (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-OUTPUT_LIMIT);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const exited = new Promise<ChromeExit>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => {
      keep(Buffer.from(`${error.message}\n`));
      resolve({ code: null, signal: null });
    });
  });
  const pid = child.pid;
  if (pid !== undefined) void exited.then(() => options.registry?.remove(pid));
  const onPhone = launch.command !== options.executablePath;
  const transport = onPhone
    ? await devToolsPortTransport(options.userDataDir, exited, options.handshakeTimeoutMs ?? 60_000)
    : pipeTransport(child.stdio[3] as Writable, child.stdio[4] as Readable);
  let version: BrowserVersion;
  try {
    if (pid !== undefined) options.registry?.add({ pid, startTime: null, userDataDir: options.userDataDir, ownerPid: process.pid, launchedAt: new Date().toISOString() });
    version = await handshake(transport, exited, options.handshakeTimeoutMs ?? 60_000);
  } catch (error) {
    killTree(child, "SIGKILL");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    const diagnosis = await diagnoseLaunchFailure({ executable: options.executablePath, output, env }).catch(() => null);
    throw new ChromeLaunchError(diagnosis?.message ?? (error instanceof Error ? error.message : String(error)), output);
  }
  const wait = (ms: number) => Promise.race([exited, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
  const stop = async (graceMs: number): Promise<ChromeExit> => {
    const polite = await wait(graceMs);
    if (polite) return polite;
    // Chrome quits when its pipe closes.
    transport.close();
    const unpiped = await wait(2_000);
    if (unpiped) return unpiped;
    killTree(child, "SIGTERM");
    const terminated = await wait(2_000);
    if (terminated) return terminated;
    killTree(child, "SIGKILL");
    return exited;
  };
  const kill = async (): Promise<ChromeExit> => {
    killTree(child, "SIGKILL");
    return exited;
  };
  return {
    pid: pid!,
    argv,
    transport,
    version,
    exited,
    output: () => output,
    close: (graceMs = 5_000) => stop(graceMs),
    kill,
  };
}
