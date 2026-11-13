import { APP_EXTENSION_KEY } from "../shared/app.js";
import { augmentedPath } from "./env-path.js";
import { PROVIDER_CREDENTIAL_ENV, stripWorkspaceCredentialEnv, } from "./config.js";
import { createLineSplitter } from "./mcp-bridge.js";
import { UI_EXTENSION, withUiExtension } from "./mcp-app-observer.js";
import { MAX_REMOTE_MCP_BYTES, McpHttpError, McpRpcError, REMOTE_MCP_STARTUP_MS, RemoteMcpClient } from "./mcp-http.js";
import { discoverMcpAuth } from "./mcp-oauth-discovery.js";
import { isRemoteMcpServer } from "./mcp-registry.js";
import { killCliTree, spawnCli } from "./procs.js";
export const SIGN_IN_REQUIRED = "This server needs you to sign in.";
/** How MCP servers word a refused key in a JSON-RPC error when they answer it with HTTP 200. */
const UNAUTHORIZED = /unauthori[sz]ed|forbidden|not authenticated|authentication (?:failed|required)|invalid (?:api[ _-]?)?(?:key|token|credentials)/i;
const MAX_STDOUT_BYTES = MAX_REMOTE_MCP_BYTES;
const MAX_TOOLS = 100;
export const STDIO_PROBE_TIMEOUT_MS = 8_000;
export const REMOTE_PROBE_TIMEOUT_MS = REMOTE_MCP_STARTUP_MS;
export function probeEnvironment(server) {
    const env = { ...process.env, PATH: augmentedPath() };
    stripWorkspaceCredentialEnv(env);
    for (const key of PROVIDER_CREDENTIAL_ENV)
        delete env[key];
    Object.assign(env, server.env);
    return env;
}
function publicProbeError(kind) {
    if (kind === "spawn")
        return "Could not start this command. Check that it is installed and executable.";
    if (kind === "timeout")
        return "The server did not answer in time.";
    if (kind === "closed")
        return "The server stopped before the MCP handshake finished.";
    if (kind === "cancelled")
        return "Connection test was cancelled.";
    return "The command did not return a valid MCP tools list.";
}
function redactConfiguredValues(value, secrets) {
    let redacted = value;
    for (const secret of Object.values(secrets)) {
        if (secret)
            redacted = redacted.split(secret).join("[redacted]");
    }
    return redacted;
}
/** Bounded and redacted: `secrets` are configured values a careless server might echo. */
function publicTools(raw, secrets) {
    const named = raw.filter((entry) => !!entry && typeof entry === "object" && typeof entry.name === "string" && !!entry.name.trim());
    const tools = named.slice(0, MAX_TOOLS).map((candidate) => ({
        name: redactConfiguredValues(candidate.name, secrets).slice(0, 200),
        ...(typeof candidate.description === "string"
            ? { description: redactConfiguredValues(candidate.description, secrets).slice(0, 500) }
            : {}),
    }));
    return named.length > tools.length ? { tools, total: named.length } : { tools };
}
/** Never returns what the renderer must not see: child stderr, environment values, header values. */
export function probeMcpServer(server, timeoutMs, signal, options = {}) {
    return isRemoteMcpServer(server)
        ? probeRemoteMcpServer(server, timeoutMs ?? REMOTE_PROBE_TIMEOUT_MS, signal, options)
        : probeStdioMcpServer(server, timeoutMs ?? STDIO_PROBE_TIMEOUT_MS, signal, options);
}
function observeProbe(options, tools, uiExtension) {
    try {
        options.observe?.({ tools, uiExtension });
    }
    catch { }
}
async function probeRemoteMcpServer(server, timeoutMs, signal, options = {}) {
    if (signal?.aborted)
        return { ok: false, error: publicProbeError("cancelled") };
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const client = options.via
        ? new RemoteMcpClient({ ...server, url: options.via.url, headers: {} }, { maxBytes: MAX_REMOTE_MCP_BYTES, fetch: options.via.fetch })
        : new RemoteMcpClient(server, { maxBytes: MAX_REMOTE_MCP_BYTES });
    try {
        await client.initialize("SpokyBot", combined, options.extension ? { extensions: { [APP_EXTENSION_KEY]: UI_EXTENSION } } : {});
        const result = await client.request("tools/list", {}, combined);
        const tools = result && typeof result === "object" ? result.tools : undefined;
        if (!Array.isArray(tools))
            return { ok: false, error: "The server did not return a valid MCP tools list." };
        observeProbe(options, tools, client.extensions ?? "unknown");
        const secrets = server.oauth?.clientSecret ? { ...server.headers, "oauth.clientSecret": server.oauth.clientSecret } : server.headers;
        return { ok: true, ...publicTools(tools, secrets) };
    }
    catch (error) {
        if (signal?.aborted)
            return { ok: false, error: publicProbeError("cancelled") };
        if (timeout.signal.aborted)
            return { ok: false, error: publicProbeError("timeout"), reason: "timeout" };
        if (error instanceof McpHttpError && error.status === 401) {
            const discovery = AbortSignal.timeout(5_000);
            const meta = await discoverMcpAuth(server.url, error.wwwAuthenticate ?? null, {
                signal: signal ? AbortSignal.any([signal, discovery]) : discovery,
            }).catch(() => null);
            if (meta)
                return { ok: false, auth: "required", error: SIGN_IN_REQUIRED };
        }
        if (error instanceof McpHttpError && error.kind === "status" && (error.status === 401 || error.status === 403)) {
            return { ok: false, error: `The server didn't accept the keys (HTTP ${error.status}). Check the header values.`, reason: "keys", status: error.status };
        }
        if (error instanceof McpRpcError && UNAUTHORIZED.test(error.detail)) {
            return { ok: false, error: "The server didn't accept the keys. Check the header values.", reason: "keys" };
        }
        if (error instanceof McpHttpError && error.kind === "status") {
            return { ok: false, error: `The server answered HTTP ${error.status}. Check the address and headers.`, ...(error.status !== undefined && error.status >= 500 ? { reason: "unreachable" } : {}) };
        }
        if (error instanceof McpHttpError && error.kind === "protocol") {
            return { ok: false, error: "The server did not return a valid MCP tools list." };
        }
        return { ok: false, error: "Could not reach this address. Check the URL and your network.", reason: "unreachable" };
    }
    finally {
        clearTimeout(timer);
        await client.close().catch(() => { });
    }
}
const INITIALIZE = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "SpokyBot", version: "probe" } };
/** Always reaped, never inherits OpenMaus credentials. */
function probeStdioMcpServer(server, timeoutMs, signal, options = {}) {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve({ ok: false, error: publicProbeError("cancelled") });
            return;
        }
        let child;
        try {
            child = spawnCli(server.command, server.args, {
                ...(options.asBot ? (options.asBot.cwd ? { cwd: options.asBot.cwd } : {}) : { cwd: process.cwd() }),
                env: probeEnvironment(server),
                stdio: ["pipe", "pipe", "pipe"],
                ...(options.asBot ? { box: { ...(options.asBot.id ? { botId: options.asBot.id } : {}), allowEnv: Object.keys(server.env) } } : {}),
            });
        }
        catch {
            resolve({ ok: false, error: publicProbeError("spawn") });
            return;
        }
        let settled = false;
        let stdoutBytes = 0;
        let initialized = false;
        let uiExtension = options.extension ? "ok" : "unknown";
        let timer;
        const onAbort = () => finish({ ok: false, error: publicProbeError("cancelled") });
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            killCliTree(child);
            resolve(result);
        };
        const write = (frame) => {
            try {
                child.stdin.write(`${JSON.stringify(frame)}\n`);
            }
            catch {
                finish({ ok: false, error: publicProbeError("closed") });
            }
        };
        const splitter = createLineSplitter((line) => {
            if (settled || !line.trim())
                return;
            let frame;
            try {
                frame = JSON.parse(line);
            }
            catch {
                return;
            }
            if (!frame || typeof frame !== "object")
                return;
            const value = frame;
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
            if (value.id !== 2)
                return;
            const result = value.result;
            if (!Array.isArray(result?.tools)) {
                finish({ ok: false, error: publicProbeError("protocol") });
                return;
            }
            observeProbe(options, result.tools, uiExtension);
            finish({ ok: true, ...publicTools(result.tools, server.env) });
        });
        timer = setTimeout(() => {
            finish({ ok: false, error: publicProbeError("timeout"), reason: "timeout" });
        }, timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (chunk) => {
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > MAX_STDOUT_BYTES) {
                finish({ ok: false, error: publicProbeError("protocol") });
                return;
            }
            splitter.push(chunk);
        });
        // Drain without retaining: child stderr often contains secrets.
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
