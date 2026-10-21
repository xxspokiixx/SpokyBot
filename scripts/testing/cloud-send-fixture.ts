// Two real servers for Send to My Cloud: this computer's, started as the desktop app starts it (its private
// utility-process port emulated over Node's IPC, the owner's capability delivered through it), and the person's Cloud
// home, paired the way the Admin pairs it. Main's own wiring (electron/cloud-send-main.mjs) sits between them with a fake
// ipcMain. Disposable homes, a synthetic Claude CLI and a fake 1Password SDK; no network.
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLoginHandoffClient, type ConnectionAsk } from "../../electron/cloud-logins.mjs";
import { createCloudMove } from "../../electron/cloud-move.mjs";
import { installCloudSend } from "../../electron/cloud-send-main.mjs";
import type { CloudMoveCheck, CloudSendOutcome } from "../../electron/cloud-send.mjs";
import { cloudPairingSignature } from "../../server/cloud-home.ts";
import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { freePortBlock } from "../../server/testing/ports.ts";

const SERVER_DIR = fileURLToPath(new URL("../../server/", import.meta.url));
export const CLOUD_HOST = "omb-t-5e6d7c8b9a0f.fly.dev";
const EDGE = { host: CLOUD_HOST, "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https", origin: `https://${CLOUD_HOST}` };
const parse = (text: string) => { try { return JSON.parse(text); } catch { return null; } };

export interface CloudSendFixture {
  root: string;
  desktopBase: string;
  cloudBase: string;
  /** The owner's own device on My Cloud, through the edge: what the window's Cloud session is. */
  owner: string;
  ownerCapability: string;
  edge: typeof EDGE;
  /** Every answer either server gave, for the no-secret check. */
  answers: string[];
  logs(): string;
  local(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  onCloud(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  /** A picture on this computer's server, as an avatarUrl. */
  picture(bytes: Uint8Array): Promise<string>;
  /** Main's IPC handlers, as this computer's page (or My Cloud's, with page "cloud") calls them. */
  call<T>(channel: string, page: "local" | "cloud", ...args: unknown[]): Promise<T>;
  /** The labels of the sessions each send made on My Cloud, as main asked for them. */
  labels: string[];
  /** The Admin's one-time code for this Cloud, as pairHome() gives it. */
  grant(label: string): Promise<{ origin: string; code: string; expiresAt: number }>;
  /** The switcher's send line, as main builds it. */
  menu(): { waiting: { bots: number; total: number } | null; onSend(): void; onOpen(): void };
  /** A pass of the one-time move, through main's own wiring; `final`: the one after this computer stopped. */
  move(options?: { final?: boolean }): Promise<CloudSendOutcome>;
  /** The move's check of what arrived, through main's own wiring. */
  check(): Promise<CloudMoveCheck>;
  /** The labels of the sessions each send made, and whether each counted as someone using My Cloud. */
  sessions: Array<{ label: string; background: boolean }>;
  /** Each request main sent My Cloud's chats route: the rows of each conversation it carried. */
  chatRequests: Array<Array<{ threadId: string; rows: number }>>;
  /** With `broker`: this computer's installation on the connected-apps service. */
  desktopInstallation: { id: string; token: string; userId: string } | null;
  /** This computer's server's private port, asked as main asks it (cloud-logins.mjs). */
  handoff(what: ConnectionAsk): Promise<any>;
  close(): Promise<void>;
}

function fakeOnePassword(at: string, token: string): string {
  const sdk = join(at, "node_modules", "@1password", "sdk");
  mkdirSync(sdk, { recursive: true });
  writeFileSync(join(sdk, "package.json"), JSON.stringify({ name: "@1password/sdk", version: "0.5.0", main: "index.js" }));
  writeFileSync(join(sdk, "index.js"), `"use strict";
exports.createClient = async ({ auth }) => {
  if (auth !== ${JSON.stringify(token)}) throw new Error("error authenticating: invalid service account token");
  return {
    vaults: { list: async () => [{ id: "v1", title: "Shared with OpenMausBot" }] },
    items: { list: async () => [], getAll: async () => ({ individualResponses: [] }) },
  };
};
`);
  return at;
}

/** `cloudOnePasswordToken`: the token My Cloud's 1Password accepts (default: this computer's), so a test can make 1Password
 * refuse this computer's token on My Cloud. `toolCalls`: each turn on this computer makes that many tool calls first, so a
 * few turns make a conversation of several pages. `broker`: the connected-apps service both servers use, this computer
 * with an installation of its own as the desktop app registers one, My Cloud registering itself as a Cloud home does.
 * `env`: more of both servers' environment (a fake HighLevel and its relay). `cloudEngine`: lines run at the start of My
 * Cloud's synthetic Claude CLI, to script its turns (fake-claude-cli.ts). */
export async function launchCloudSendFixture({ onePasswordToken, cloudOnePasswordToken = onePasswordToken, toolCalls = 0, broker, env = {}, cloudEnv = {}, cloudEngine = "", desktopEngine = "", space }: {
  onePasswordToken: string; cloudOnePasswordToken?: string; toolCalls?: number;
  broker?: { url: string; install(): Promise<{ id: string; token: string; userId: string }> };
  env?: NodeJS.ProcessEnv;
  /** My Cloud's own environment only (a store limit, say). */
  cloudEnv?: NodeJS.ProcessEnv;
  cloudEngine?: string;
  /** The same for this computer's synthetic Claude CLI. */
  desktopEngine?: string;
  /** My Cloud's plan disk and the Admin's grow, as main gives them to a move. */
  space?: { disk(): unknown; grow(sizeGb: number): Promise<unknown> };
}): Promise<CloudSendFixture> {
  const root = mkdtempSync(join(tmpdir(), "omb-cloud-send-"));
  const secret = randomBytes(32).toString("base64url");
  const ownerCapability = randomBytes(32).toString("base64url");
  const answers: string[] = [];
  const labels: string[] = [];
  let logs = "";
  const children: ChildProcess[] = [];
  const remember = async (response: Response) => { answers.push(await response.clone().text()); return response; };

  async function start(name: string, own: NodeJS.ProcessEnv, port: number, extra: string[] = [], ipc = false, acceptedToken = onePasswordToken, calls = 0, engine = ""): Promise<ChildProcess> {
    const home = join(root, name);
    const dataDir = join(home, ".openmausbot");
    mkdirSync(dataDir, { recursive: true });
    const cli = join(home, "fixture-claude.mjs");
    const tools = calls ? JSON.stringify(Array.from({ length: calls }, (_, i) => ({ name: "Bash", input: { command: `echo step ${i}` } }))) : "";
    writeFileSync(cli, `#!/usr/bin/env node
if (process.argv[2] === "auth") { console.log(JSON.stringify({ loggedIn: true, email: "person@example.test" })); process.exit(0); }
process.env.FAKE_CLAUDE_VERSION = "2.1.284";
${tools ? `process.env.FAKE_CLAUDE_TOOL_CALLS = ${JSON.stringify(tools)};` : ""}
${engine}
await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, "testing", "fake-claude-cli.ts")).href)});
`, { mode: 0o755 });
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ instances: {
      ...Object.fromEntries(["codex", "cursor", "openaiCompat", "qwen", "hermes", "pi", "grok"].map((id) => [id, { driver: "not-a-real-driver" }])),
      claude: { driver: "claudeAgent", displayName: "Claude", config: { cli } },
    } }));
    const offline = `data:text/javascript,${encodeURIComponent('const real = globalThis.fetch; globalThis.fetch = async (url, init) => String(url).startsWith("http://127.0.0.1:") ? real(url, init) : new Response("offline fixture", { status: 503 });')}`;
    const child = spawn(process.execPath, ["--import", offline, ...extra, join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), HOME: home, USERPROFILE: home, OMB_DATA_DIR: dataDir,
        OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1), OMB_DUCKDB_DIR: fakeOnePassword(join(home, "native"), acceptedToken), ...env, ...own },
      stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc" as const] : [])],
    });
    children.push(child);
    child.stdout?.on("data", (chunk) => { logs += chunk; });
    child.stderr?.on("data", (chunk) => { logs += chunk; });
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`${name} exited:\n${logs}`);
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child; } catch {}
      if (Date.now() > deadline) throw new Error(`${name} did not start:\n${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const parentPort = `data:text/javascript,${encodeURIComponent(`
    const listeners = [];
    Object.defineProperty(process, "parentPort", { value: {
      on(event, listener) { if (event === "message") listeners.push(listener); },
      postMessage(message) { process.send?.(message); },
    } });
    process.on("message", (data) => { for (const listener of listeners) listener({ data }); });
    process.channel?.unref();
  `)}`;
  const desktopPort = await freePortBlock([0, 1]);
  const desktopBase = `http://127.0.0.1:${desktopPort}`;
  const desktopInstallation = broker ? await broker.install() : null;
  const desktop = await start("desktop", { OMB_DESKTOP_PARENT: "1",
    ...(broker && desktopInstallation ? { OMB_COMPOSIO_BROKER_URL: broker.url, OMB_COMPOSIO_BROKER_TOKEN: desktopInstallation.token } : {}) }, desktopPort, ["--import", parentPort], true, onePasswordToken, toolCalls, desktopEngine);
  desktop.send({ type: "openmausbot:desktop-mutation-token", token: ownerCapability });
  const cloudPort = await freePortBlock([0, 1]);
  const cloudBase = `http://127.0.0.1:${cloudPort}`;
  await start("cloud", { OMB_CLOUD_ROLE: "home", OMB_CLOUD_MACHINE_ID: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", OMB_CLOUD_ADMIN_URL: "https://cloud.example.test",
    OMB_CLOUD_BOOTSTRAP_SECRET: secret, OMB_PUBLIC_URL: `https://${CLOUD_HOST}`, ...(broker ? { OMB_COMPOSIO_BROKER_URL: broker.url } : {}), ...cloudEnv }, cloudPort, [], false, cloudOnePasswordToken, 0, cloudEngine);

  const mintCode = async (label: string) => {
    const body = JSON.stringify({ label, ttlSeconds: 300 });
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("base64url");
    const response = await fetch(`${cloudBase}/api/cloud/pairing`, { method: "POST", headers: { ...EDGE, "content-type": "application/json",
      "x-omb-cloud-timestamp": timestamp, "x-omb-cloud-nonce": nonce, "x-omb-cloud-signature": `v1=${cloudPairingSignature(secret, timestamp, nonce, body)}` }, body });
    return ((await response.json()) as { code: string }).code;
  };
  const paired = await fetch(`${cloudBase}/api/auth/pair`, { method: "POST", headers: { ...EDGE, "content-type": "application/json" }, body: JSON.stringify({ code: await mintCode("OpenMausBot app (Cloud)") }) });
  const owner = ((await paired.json()) as { token: string }).token;

  const local = async (method: string, path: string, body?: unknown) => {
    const response = await remember(await fetch(`${desktopBase}${path}`, { method, headers: {
      "x-openmausbot-desktop-owner": ownerCapability, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, body: parse(await response.text()) };
  };
  const onCloud = async (method: string, path: string, body?: unknown) => {
    const response = await remember(await fetch(`${cloudBase}${path}`, { method, headers: { ...EDGE, authorization: `Bearer ${owner}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, body: parse(await response.text()) };
  };
  for (let tries = 0; (await local("GET", "/api/bots")).status !== 200 && tries < 50; tries++) await new Promise((resolve) => setTimeout(resolve, 100));

  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const port = { postMessage: (message: unknown) => { desktop.send(message as object); } };
  const chatRequests: CloudSendFixture["chatRequests"] = [];
  const sessions: CloudSendFixture["sessions"] = [];
  const throughEdge = (bearer: string | null) => async (url: string | URL | Request, init: RequestInit = {}) => {
    if (String(url).endsWith("/api/cloud-send/chats") && init.method === "POST" && typeof init.body === "string") {
      chatRequests.push((JSON.parse(init.body) as { conversations: Array<{ threadId: string; rows: unknown[] }> }).conversations.map((entry) => ({ threadId: entry.threadId, rows: entry.rows.length })));
    }
    if (String(url).endsWith("/api/auth/pair") && typeof init.body === "string") {
      const { label } = JSON.parse(init.body) as { label: string };
      labels.push(label);
      sessions.push({ label, background: (init.headers as Record<string, string>)["x-omb-background"] === "1" });
    }
    return remember(await fetch(url, { ...init, headers: { ...init.headers as Record<string, string>, ...EDGE, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } }));
  };
  // Bring newer chats, as main.mjs gives it to Send to My Cloud.
  const move = createCloudMove({
    localRequest: (route, init) => fetch(`${desktopBase}${route}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": ownerCapability } }),
    fetchImpl: ((url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...EDGE } })) as typeof fetch,
    tempRoot: join(root, "send-move-temp"), availableBytes: async () => Number.MAX_SAFE_INTEGER, pollMs: 150, retryDelaysMs: [100, 300],
  });
  const main = installCloudSend({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
    localOnly: (channel, handler) => ((event: { page?: string }, ...args: unknown[]) => {
      if (event?.page !== "local") throw new Error(`${channel} is only available in this app's window`);
      return handler(event, ...args);
    }) as typeof handler,
    cloudPage: (event) => (event as { page?: "local" | "cloud" })?.page ?? null,
    server: () => port,
    local: async (route, init) => remember(await fetch(`${desktopBase}${route}`, { method: init?.method ?? "GET", headers: { "x-openmausbot-desktop-owner": ownerCapability } })),
    home: () => ({ origin: cloudBase, grant: async () => ({ origin: cloudBase, code: await mintCode("OpenMausBot app (Cloud)") }) }),
    cookieFetch: throughEdge(owner) as typeof fetch,
    reconnect: async () => false,
    power: { asleep: () => false },
    file: () => join(root, "cloud-send.json"),
    window: () => null,
    localOrigin: () => desktopBase,
    openSettings: () => {},
    fetch: throughEdge(null) as typeof fetch,
    bringChats: () => move.bring({ id: "cloud", name: "My Cloud", origin: cloudBase, kind: "cloud", grant: async () => ({ origin: cloudBase, code: await mintCode("Copy from desktop") }) }),
    engineWaitMs: 2_000,
    ...(space ? { space } : {}),
  });
  desktop.on("message", (message) => main.receive(port, message));
  const asks = createLoginHandoffClient();
  desktop.on("message", (message) => { asks.receive(port, message); });

  return {
    root, desktopBase, cloudBase, owner, ownerCapability, edge: EDGE, answers, labels, logs: () => logs, local, onCloud, desktopInstallation,
    handoff: (what) => asks.request(port, what),
    async picture(bytes) {
      const response = await fetch(`${desktopBase}/api/attachments`, { method: "POST", headers: { "x-openmausbot-desktop-owner": ownerCapability, "content-type": "image/png" }, body: bytes });
      return `/api/attachments/${((await response.json()) as { path: string }).path.split(/[\\/]/).pop()}`;
    },
    call: <T>(channel: string, page: "local" | "cloud", ...args: unknown[]) => Promise.resolve(handlers.get(channel)!({ page }, ...args)) as Promise<T>,
    menu: () => main.menu(),
    move: (options) => main.move(options),
    check: () => main.check(),
    sessions,
    chatRequests,
    grant: async (label) => ({ origin: cloudBase, code: await mintCode(label), expiresAt: Date.now() + 300_000 }),
    async close() {
      await move.close();
      for (const child of children) await waitForExit(child, { signal: "SIGTERM" });
      await removeTempDir(root);
    },
  };
}
