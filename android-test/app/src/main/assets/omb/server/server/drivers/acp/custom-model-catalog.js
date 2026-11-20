import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { killCliTree, spawnCli } from "../../procs.js";
import { acpModelOption, acpVariantOption } from "./config-options.js";
const REQUEST_TIMEOUT_MS = 8_000;
const DISCOVERY_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_MODELS = 128;
/** The `clientInfo.name` every discovery session is opened with. */
export const DISCOVERY_CLIENT_NAME = "openmausbot-model-discovery";
/** The agent answered a discovery request with a JSON-RPC error, so it is reachable. Its own text stays
 * off `message`, which callers may show. */
export class AcpDiscoveryRpcError extends Error {
    code;
    rpcMessage;
    constructor(code, rpcMessage) {
        super("ACP model discovery request was rejected by the agent.");
        this.code = code;
        this.rpcMessage = rpcMessage.slice(0, 500);
    }
}
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value : undefined;
}
/** Stops the agent, first letting it exit on its own when asked to. Returns whether it stopped. */
async function stopDiscovery(child, graceMs) {
    if (!child)
        return true;
    if (graceMs !== undefined && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", () => resolve()));
        try {
            child.stdin.end();
        }
        catch { }
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, graceMs).unref())]);
    }
    // A wrapper that exits on EOF must wait for its agent (Copilot CLI 1.0.103's npm-loader does, through spawnSync): once the
    // direct child is gone, taskkill /T cannot find the tree. Windows stops it through taskkill, which needs seconds.
    return killCliTree(child, process.platform === "win32" ? 5_000 : 500);
}
const AGENT_DEFAULT = { id: "agent-default", label: "Agent default" };
export function resolveCustomAcpModels(env, config, _instanceId) {
    return discoverAcpModels(env, config.cli, [], { passthrough: AGENT_DEFAULT, custom: true });
}
/** Reads the models an ACP agent advertises in an empty folder, without a prompt, tool, MCP server or permission. */
export async function discoverAcpModels(env, cli, args, discovery = {}) {
    const cwd = await mkdtemp(join(tmpdir(), "omb-acp-models-"));
    let child;
    let globalTimer;
    const pending = new Map();
    let failure;
    let sequence = 0;
    let updateSequence = 0;
    let sessionId;
    let latestUpdate;
    let outputBytes = 0;
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    let catalog;
    let thrown;
    const fail = (message) => {
        failure ??= new Error(message);
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(failure);
        }
        pending.clear();
    };
    const count = (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT_BYTES)
            fail("ACP model discovery exceeded its output limit.");
        return !failure;
    };
    const send = (message) => { if (!failure)
        child?.stdin.write(`${JSON.stringify(message)}\n`); };
    const receive = (line) => {
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            return;
        }
        const message = record(parsed);
        if (!message)
            return;
        if (typeof message.method === "string" && message.id !== undefined) {
            // Discovery never grants filesystem, terminal, tool or permission requests.
            send(message.method === "session/request_permission"
                ? { jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } }
                : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unavailable during model discovery" } });
            return;
        }
        if (message.method === "session/update") {
            const params = record(message.params);
            const update = record(params?.update);
            if (sessionId && params?.sessionId === sessionId && update?.sessionUpdate === "config_option_update") {
                latestUpdate = update;
                updateSequence++;
            }
            return;
        }
        if (typeof message.id !== "number")
            return;
        const entry = pending.get(message.id);
        if (!entry)
            return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error !== undefined) {
            const error = record(message.error);
            entry.reject(new AcpDiscoveryRpcError(error?.code, typeof error?.message === "string" ? error.message : ""));
        }
        else
            entry.resolve(message.result);
    };
    const request = (method, params) => {
        if (failure)
            return Promise.reject(failure);
        const id = ++sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error("ACP model discovery request timed out."));
            }, REQUEST_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            send({ jsonrpc: "2.0", id, method, params });
        });
    };
    try {
        child = spawnCli(cli, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] }, "bot");
        child.on("error", () => fail("Could not start the ACP agent for model discovery."));
        child.on("close", () => fail("ACP agent closed during model discovery."));
        child.stdout.on("data", (chunk) => {
            if (!count(chunk))
                return;
            buffer += decoder.write(chunk);
            let newline;
            while ((newline = buffer.indexOf("\n")) >= 0 && !failure) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
                    fail("ACP model discovery exceeded its line limit.");
                    break;
                }
                receive(line);
            }
            if (Buffer.byteLength(buffer) > MAX_LINE_BYTES)
                fail("ACP model discovery exceeded its line limit.");
        });
        child.stderr.on("data", (chunk) => { count(chunk); });
        globalTimer = setTimeout(() => fail("ACP model discovery timed out."), DISCOVERY_TIMEOUT_MS);
        await request("initialize", {
            protocolVersion: 1,
            clientInfo: { name: DISCOVERY_CLIENT_NAME, version: "1" },
            clientCapabilities: {
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false,
                ...(discovery.clientCapabilitiesMeta ? { _meta: discovery.clientCapabilitiesMeta } : {}),
            },
        });
        const initial = await request("session/new", { cwd, mcpServers: [] });
        const rawSessionId = record(initial)?.sessionId;
        if (typeof rawSessionId !== "string" || !rawSessionId)
            throw new Error("ACP model discovery did not return a session.");
        sessionId = rawSessionId;
        const modelOption = acpModelOption(initial);
        if (!modelOption?.options.length)
            throw new Error("The ACP agent did not advertise any models. The previous catalog was kept.");
        if (modelOption.options.length > MAX_MODELS)
            throw new Error("The ACP model catalog exceeded the discovery limit.");
        const mark = discovery.custom ? { custom: true } : {};
        const { passthrough } = discovery;
        const options = passthrough ? [{ ...passthrough, ...mark }] : [];
        for (const model of modelOption.options) {
            if (model.id === passthrough?.id)
                continue;
            if (failure)
                throw failure;
            let confirmed;
            if (model.id === modelOption.currentValue) {
                confirmed = initial;
            }
            else if (discovery.variants !== false) {
                const previousUpdate = updateSequence;
                try {
                    const response = modelOption.configId
                        ? await request("session/set_config_option", { sessionId, configId: modelOption.configId, value: model.id })
                        : await request("session/set_model", { sessionId, modelId: model.id });
                    if (acpModelOption(response)?.currentValue === model.id)
                        confirmed = response;
                    else if (updateSequence > previousUpdate && acpModelOption(latestUpdate)?.currentValue === model.id)
                        confirmed = latestUpdate;
                }
                catch {
                    if (failure)
                        throw failure;
                }
            }
            const variants = confirmed ? acpVariantOption(confirmed)?.options : undefined;
            const label = discovery.label ? discovery.label(model, initial) : model.label;
            options.push({ ...model, label, ...mark, ...(variants?.length ? { variants } : {}) });
        }
        if (failure)
            throw failure;
        const preferred = discovery.default && options.some((option) => option.id === discovery.default) ? discovery.default : undefined;
        catalog = { default: passthrough?.id ?? preferred ?? modelOption.currentValue ?? options[0].id, options };
    }
    catch (error) {
        thrown = error;
    }
    finally {
        if (globalTimer)
            clearTimeout(globalTimer);
        fail("ACP model discovery finished.");
        let stopped = false;
        try {
            stopped = await stopDiscovery(child, discovery.exitGraceMs);
            if (stopped && sessionId)
                await discovery.forgetSession?.({ sessionId, cwd, env }).catch(() => undefined);
        }
        finally {
            await rm(cwd, { recursive: true, force: true });
        }
        // The discovery's own failure says more than a process that would not stop.
        if (!stopped)
            thrown ??= new Error("The ACP discovery process could not be stopped.");
    }
    if (thrown !== undefined)
        throw thrown;
    return catalog;
}
