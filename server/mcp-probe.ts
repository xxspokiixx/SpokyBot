import { APP_EXTENSION_KEY } from "../shared/app.ts";
import { augmentedPath } from "./env-path.ts";
import {
  PROVIDER_CREDENTIAL_ENV,
  stripWorkspaceCredentialEnv,
} from "./config.ts";
import { createLineSplitter } from "./mcp-bridge.ts";
import { UI_EXTENSION, withUiExtension } from "./mcp-app-observer.ts";
import { MAX_REMOTE_MCP_BYTES, McpHttpError, REMOTE_MCP_STARTUP_MS, RemoteMcpClient } from "./mcp-http.ts";
import { discoverMcpAuth } from "./mcp-oauth-discovery.ts";
import { isRemoteMcpServer, type StoredMcpServer, type StoredRemoteMcpServer, type StoredStdioMcpServer } from "./mcp-registry.ts";
import { killCliTree, spawnCli } from "./procs.ts";

export interface McpProbeTool {
  name: string;
  description?: string;
}

export type McpProbeResult =
  /** `total` is set when the server advertised more tools than `tools` shows. */
  | { ok: true; tools: McpProbeTool[]; total?: number }
  | { ok: false; error: string; auth?: "required" };

export const SIGN_IN_REQUIRED = "This server needs you to sign in.";

/** MCP Apps (server/chat-apps-mcp.ts): advertise the UI extension, falling
 * back to the plain handshake when the server refuses it, and hand the raw
 * tool list to the app catalog. Neither changes what the renderer sees. */
export interface McpProbeOptions {
  extension?: boolean;
  observe?(info: { tools: unknown[]; uiExtension: "ok" | "refused" | "unknown" }): void;
}

/** A command that bridges to a big URL server (`npx mcp-remote …`) prints
 * the same 1.2 MB tools list the URL test reads, so it gets the same cap. */
const MAX_STDOUT_BYTES = MAX_REMOTE_MCP_BYTES;
const MAX_TOOLS = 100;
/** A command starts on this computer and answers fast. */
export const STDIO_PROBE_TIMEOUT_MS = 8_000;
/** A URL server answers over the internet, so it gets more room than a
 * command. Whop's 425-tool list measured 1 to 2 s with a real sign-in; what
 * failed it was the old 1 MiB response cap, never the clock. */
export const REMOTE_PROBE_TIMEOUT_MS = REMOTE_MCP_STARTUP_MS;

/** The environment a command server is started with outside a turn (a
 * probe, an MCP app's own connection): this machine's PATH, none of
 * OpenMausBot's credentials, then the server's own env. */
export function probeEnvironment(server: Pick<StoredStdioMcpServer, "env">): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: augmentedPath() };
  stripWorkspaceCredentialEnv(env);
  for (const key of PROVIDER_CREDENTIAL_ENV) delete env[key];
  Object.assign(env, server.env);
  return env;
}

function publicProbeError(kind: "spawn" | "timeout" | "protocol" | "closed" | "cancelled"): string {
  if (kind === "spawn") return "Could not start this command. Check that it is installed and executable.";
  if (kind === "timeout") return "The server did not answer in time.";
  if (kind === "closed") return "The server stopped before the MCP handshake finished.";
  if (kind === "cancelled") return "Connection test was cancelled.";
  return "The command did not return a valid MCP tools list.";
}

function redactConfiguredValues(value: string, secrets: Record<string, string>): string {
  let redacted = value;
  for (const secret of Object.values(secrets)) {
    if (secret) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

/** The bounded, redacted tool list the renderer may see, and how many tools
 * the server really advertised when that is more than the list shows.
 * `secrets` are the configured values (env or header values) a careless
 * server might echo. */
function publicTools(raw: unknown[], secrets: Record<string, string>): { tools: McpProbeTool[]; total?: number } {
  const named = raw.filter((entry): entry is Record<string, unknown> =>
    !!entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string" && !!(entry as { name: string }).name.trim());
  const tools = named.slice(0, MAX_TOOLS).map((candidate) => ({
    name: redactConfiguredValues(candidate.name as string, secrets).slice(0, 200),
    ...(typeof candidate.description === "string"
      ? { description: redactConfiguredValues(candidate.description, secrets).slice(0, 500) }
      : {}),
  }));
  return named.length > tools.length ? { tools, total: named.length } : { tools };
}

/** Prove the MCP handshake and list the tools of one configured server,
 * whichever way it is reached. Neither path returns anything the renderer
 * must not see: child stderr, environment values, header values. */
export function probeMcpServer(
  server: StoredMcpServer,
  timeoutMs?: number,
  signal?: AbortSignal,
  options: McpProbeOptions = {},
): Promise<McpProbeResult> {
  return isRemoteMcpServer(server)
    ? probeRemoteMcpServer(server, timeoutMs ?? REMOTE_PROBE_TIMEOUT_MS, signal, options)
    : probeStdioMcpServer(server, timeoutMs ?? STDIO_PROBE_TIMEOUT_MS, signal, options);
}

/** What the catalog is told, after a probe listed the tools: never a reason to fail it. */
function observeProbe(options: McpProbeOptions, tools: unknown[], uiExtension: "ok" | "refused" | "unknown"): void {
  try { options.observe?.({ tools, uiExtension }); } catch { /* the catalog's trouble, not the probe's */ }
}

/** Connect to a remote server over its transport, bounded by one timeout
 * for initialize + tools/list together. HTTP status codes are safe to show
 * and are the one detail that tells a wrong token from a wrong address. */
async function probeRemoteMcpServer(
  server: StoredRemoteMcpServer,
  timeoutMs: number,
  signal?: AbortSignal,
  options: McpProbeOptions = {},
): Promise<McpProbeResult> {
  if (signal?.aborted) return { ok: false, error: publicProbeError("cancelled") };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const client = new RemoteMcpClient(server, { maxBytes: MAX_REMOTE_MCP_BYTES });
  try {
    await client.initialize("OpenMausBot", combined, options.extension ? { extensions: { [APP_EXTENSION_KEY]: UI_EXTENSION } } : {});
    const result = await client.request("tools/list", {}, combined);
    const tools = result && typeof result === "object" ? (result as { tools?: unknown }).tools : undefined;
    if (!Array.isArray(tools)) return { ok: false, error: "The server did not return a valid MCP tools list." };
    observeProbe(options, tools, client.extensions ?? "unknown");
    const secrets = server.oauth?.clientSecret ? { ...server.headers, "oauth.clientSecret": server.oauth.clientSecret } : server.headers;
    return { ok: true, ...publicTools(tools, secrets) };
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: publicProbeError("cancelled") };
    if (timeout.signal.aborted) return { ok: false, error: publicProbeError("timeout") };
    // A 401 that names an OAuth sign-in is not a wrong address or header:
    // the person has to sign in. Anything else keeps the plain status.
    if (error instanceof McpHttpError && error.status === 401) {
      const discovery = AbortSignal.timeout(5_000);
      const meta = await discoverMcpAuth(server.url, error.wwwAuthenticate ?? null, {
        signal: signal ? AbortSignal.any([signal, discovery]) : discovery,
      }).catch(() => null);
      if (meta) return { ok: false, auth: "required", error: SIGN_IN_REQUIRED };
    }
    if (error instanceof McpHttpError && error.kind === "status") {
      return { ok: false, error: `The server answered HTTP ${error.status}. Check the address and headers.` };
    }
    if (error instanceof McpHttpError && error.kind === "protocol") {
      return { ok: false, error: "The server did not return a valid MCP tools list." };
    }
    return { ok: false, error: "Could not reach this address. Check the URL and your network." };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

const INITIALIZE = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "OpenMausBot", version: "probe" } };

/** Start one stdio server long enough to prove the MCP handshake and list its
 * tools. It is always reaped, never inherits OpenMaus credentials, and never
 * returns child stderr or environment values to the renderer. */
function probeStdioMcpServer(
  server: StoredStdioMcpServer,
  timeoutMs: number,
  signal?: AbortSignal,
  options: McpProbeOptions = {},
): Promise<McpProbeResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, error: publicProbeError("cancelled") });
      return;
    }

    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(server.command, server.args, {
        cwd: process.cwd(),
        env: probeEnvironment(server),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve({ ok: false, error: publicProbeError("spawn") });
      return;
    }

    let settled = false;
    let stdoutBytes = 0;
    let initialized = false;
    /** The UI extension: advertised in initialize 1; refused means initialize 3 without it. */
    let uiExtension: "ok" | "refused" | "unknown" = options.extension ? "ok" : "unknown";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish({ ok: false, error: publicProbeError("cancelled") });
    const finish = (result: McpProbeResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      killCliTree(child);
      resolve(result);
    };
    const write = (frame: unknown) => {
      try {
        child.stdin.write(`${JSON.stringify(frame)}\n`);
      } catch {
        finish({ ok: false, error: publicProbeError("closed") });
      }
    };
    const splitter = createLineSplitter((line) => {
      if (settled || !line.trim()) return;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object") return;
      const value = frame as Record<string, unknown>;
      if (value.id === 1 && value.error !== undefined && options.extension && !initialized && uiExtension === "ok") {
        uiExtension = "refused";
        write({ jsonrpc: "2.0", id: 3, method: "initialize", params: INITIALIZE });
        return;
      }
      if ((value.id === 1 || (value.id === 3 && uiExtension === "refused")) && value.result && !initialized) {
        initialized = true;
        write({ jsonrpc: "2.0", method: "notifications/initialized" });
        write({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return;
      }
      if (value.id !== 2) return;
      const result = value.result as { tools?: unknown } | undefined;
      if (!Array.isArray(result?.tools)) {
        finish({ ok: false, error: publicProbeError("protocol") });
        return;
      }
      observeProbe(options, result.tools, uiExtension);
      finish({ ok: true, ...publicTools(result.tools, server.env) });
    });

    timer = setTimeout(() => {
      finish({ ok: false, error: publicProbeError("timeout") });
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        finish({ ok: false, error: publicProbeError("protocol") });
        return;
      }
      splitter.push(chunk);
    });
    // Drain without retaining it. Child stderr often contains secrets or
    // arbitrary native logs and is not part of the MCP protocol.
    child.stderr.resume();
    child.once("error", () => finish({ ok: false, error: publicProbeError("spawn") }));
    child.once("close", () => finish({ ok: false, error: publicProbeError("closed") }));

    if (signal?.aborted) {
      onAbort();
      return;
    }

    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: options.extension ? withUiExtension(INITIALIZE) : INITIALIZE });
  });
}
