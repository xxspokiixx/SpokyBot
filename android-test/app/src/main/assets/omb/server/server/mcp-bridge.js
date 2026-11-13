import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { CONTROL_ACT_WITHIN_MS, CONTROL_UNCONFIRMED, CONTROL_WAITED, controlRefusal, createControlClient } from "./control-client.js";
import { augmentedPath, resolveCliSpawn } from "./env-path.js";
import { textOnlyErrorResultLine } from "./mcp-error-result.js";
import { createToolListNormalizer } from "./mcp-tool-schema.js";
import { createJournalTap, postJournal } from "./saved-steps/journal-tap.js";
import { toolSchemaProfileFromEnv } from "./tool-schema-profile.js";
export const BRIDGE_INACTIVITY_MS = 45_000;
const PROBE_TIMEOUT_MS = 10_000;
export function runLivenessProbe(probe, timeoutMs = PROBE_TIMEOUT_MS, env) {
    return new Promise((resolve) => {
        const child = spawn(probe.command, probe.args, {
            shell: false,
            env: env ?? { ...process.env, PATH: augmentedPath() },
            stdio: ["ignore", "ignore", "ignore"],
        });
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve(false);
        }, timeoutMs);
        timer.unref?.();
        child.on("error", () => {
            clearTimeout(timer);
            resolve(false);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve(code === 0);
        });
    });
}
export function createInactivityWatchdog(options) {
    let timer = null;
    let stopped = false;
    let probing = false;
    let touchedWhileProbing = false;
    const arm = () => {
        if (stopped)
            return;
        timer = setTimeout(fire, options.inactivityMs);
        timer.unref?.();
    };
    const settleProbe = (alive) => {
        probing = false;
        if (stopped)
            return;
        if (alive || touchedWhileProbing) {
            arm();
            return;
        }
        options.onDead();
    };
    const fire = () => {
        probing = true;
        touchedWhileProbing = false;
        void options.probe().then(settleProbe, () => settleProbe(false));
    };
    arm();
    return {
        touch() {
            if (stopped)
                return;
            if (probing) {
                touchedWhileProbing = true;
                return;
            }
            if (timer)
                clearTimeout(timer);
            arm();
        },
        stop() {
            stopped = true;
            if (timer)
                clearTimeout(timer);
        },
    };
}
/** MCP stdio is one JSON-RPC frame per line, so line boundaries are the only safe place to inspect or inject. */
export function createLineSplitter(onLine) {
    let pending = "";
    const decoder = new StringDecoder("utf8");
    return {
        push(chunk) {
            pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
            let newline;
            while ((newline = pending.indexOf("\n")) !== -1) {
                const line = pending.slice(0, newline);
                pending = pending.slice(newline + 1);
                onLine(line);
            }
        },
        flush() {
            pending += decoder.end();
            if (pending)
                onLine(pending);
            pending = "";
        },
    };
}
/** Serialized: the check is async, and answering frame N+1 before frame N would reorder the agent's protocol stream. */
export function createGateInterceptor(options) {
    const actWithinMs = options.actWithinMs ?? CONTROL_ACT_WITHIN_MS;
    let queue = Promise.resolve();
    return (line) => {
        const arrivedAt = Date.now();
        queue = queue.then(async () => {
            let frame = null;
            try {
                frame = JSON.parse(line);
            }
            catch {
            }
            if (!frame || frame.method !== "tools/call") {
                await options.forward(line);
                return;
            }
            const state = await options.check(frame).catch(() => ({ held: true, helpOpen: false, blockedReason: CONTROL_UNCONFIRMED }));
            if (!state.held && Date.now() - arrivedAt <= actWithinMs) {
                // A relayed call is checked once, when it arrives; the next frame's check waits until it has acted.
                await options.forward(line);
                return;
            }
            options.refuse(JSON.stringify({
                jsonrpc: "2.0",
                id: frame.id ?? null,
                result: { content: [{ type: "text", text: state.held ? controlRefusal(state) : CONTROL_WAITED }], isError: true },
            }));
        });
        return queue;
    };
}
/** The bundled cua-driver (through at least v0.22.1) answers MCP `ping` with -32601, so ping is answered here. */
export function createMcpBridgeInterceptor(options) {
    const afterPing = options.gate
        ? createGateInterceptor({ check: options.gate.check, forward: options.forward, refuse: options.answer })
        : (line) => options.forward(line);
    return (line) => {
        let frame = null;
        try {
            frame = JSON.parse(line);
        }
        catch {
        }
        if (frame && frame.method === "ping") {
            // Notifications have no `id` and require no response.
            if (frame.id !== undefined) {
                options.answer(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }));
            }
            return;
        }
        return afterPing(line);
    };
}
/** Without a tap, writes are synchronous. With one, a single chain keeps replies in order while each waits for its journal post; no failure in the tap may drop a reply. */
export function createReplyQueue(tap, write) {
    let chain = Promise.resolve();
    return (raw, written) => {
        if (!tap) {
            write(written);
            return;
        }
        chain = chain
            .then(() => tap.response(raw))
            .catch(() => { })
            .then(() => write(written));
    };
}
const OWN_ID = "omb-bridge-";
const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";
function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function failed(text) {
    return { content: [{ type: "text", text }], isError: true };
}
/** A tools/call request the agent waits on, as a relay sees it; anything else is not the relay's to answer. */
function relayableCall(line) {
    let frame = null;
    try {
        frame = JSON.parse(line);
    }
    catch {
        return null;
    }
    const params = frame?.method === "tools/call" && frame.id !== undefined && frame.id !== null ? frame.params : null;
    if (!isObject(params) || typeof params.name !== "string")
        return null;
    return { id: frame.id, call: { name: params.name, arguments: isObject(params.arguments) ? params.arguments : {} }, meta: params._meta };
}
/** The bridge's own calls on the child, under ids the agent never sees. */
export function createChildCalls(write) {
    let sequence = 0;
    let driverVersion;
    let closed = false;
    const waiting = new Map();
    return {
        /** Each call carries the agent's own `_meta`: a driver spoken to with per-request metadata refuses a call without it. */
        forCall(meta) {
            return {
                call(name, args) {
                    if (closed)
                        return Promise.resolve(failed("Computer-control transport closed"));
                    const id = `${OWN_ID}${++sequence}`;
                    return new Promise((resolve) => {
                        waiting.set(id, resolve);
                        write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, ...(meta === undefined ? {} : { _meta: meta }) } }));
                    });
                },
                get driverVersion() {
                    return driverVersion;
                },
            };
        },
        /** Notes the driver's version, and keeps an answer to one of the bridge's calls from the agent (true when it did). */
        take(line) {
            const versioned = driverVersion === undefined && line.includes("serverInfo");
            const ours = waiting.size > 0 && line.includes(OWN_ID);
            if (!versioned && !ours)
                return false;
            let frame = null;
            try {
                frame = JSON.parse(line);
            }
            catch {
                return false;
            }
            const version = frame?.result?.serverInfo?.version ?? frame?.result?._meta?.[SERVER_INFO_META]?.version;
            if (versioned && typeof version === "string")
                driverVersion = version;
            const resolve = ours && typeof frame?.id === "string" ? waiting.get(frame.id) : undefined;
            if (!resolve)
                return false;
            waiting.delete(frame.id);
            resolve(isObject(frame.result) ? frame.result : failed(String(frame.error?.message ?? "Computer control returned no result")));
            return true;
        },
        /** The child is gone: every call still waiting, and any made later, ends as a failure. */
        close() {
            closed = true;
            for (const resolve of waiting.values())
                resolve(failed("Computer-control transport closed"));
            waiting.clear();
        },
    };
}
export function runMcpBridge(options) {
    const env = options.env ?? { ...process.env, PATH: augmentedPath() };
    const { command, args } = resolveCliSpawn(options.command, options.args, env);
    const child = spawn(command, args, {
        shell: false,
        env,
        stdio: ["pipe", "pipe", "pipe"],
    });
    // docker may exit before it drains stdin; pipe() leaves this error unhandled.
    child.stdin.on("error", () => { });
    child.stderr.pipe(process.stderr);
    const client = options.gate
        ? createControlClient({ url: options.gate.url, token: options.gate.token })
        : null;
    const tap = options.journal
        ? createJournalTap({ post: postJournal(options.journal.url, options.journal.token) })
        : null;
    const reply = createReplyQueue(tap, (written) => process.stdout.write(written + "\n"));
    const answer = (line) => reply(line, line);
    const toolLists = createToolListNormalizer(toolSchemaProfileFromEnv(), (line) => process.stderr.write(`${options.label}: ${line}\n`));
    // Injected responses must never land inside one of the child's half-written frames.
    const rewrite = options.rewriteResponse ?? ((line) => line);
    const respond = (line) => reply(line, textOnlyErrorResultLine(rewrite(toolLists.rewriteResponse(line))));
    const children = createChildCalls((line) => child.stdin.write(line + "\n"));
    const send = async (line) => {
        const frame = line.includes('"tools/call"') ? relayableCall(line) : null;
        const relayed = frame && options.relay?.(frame.call, children.forCall(frame.meta));
        if (!frame || !relayed) {
            child.stdin.write(line + "\n");
            return;
        }
        // Fail-closed: a relayed answer is the bridge's, never the driver's, so it is not journalled. The gate check the call
        // passed is then left without an entry, which keeps its request's journal incomplete, and an incomplete one never saves.
        tap?.leaveOut(frame.id);
        const result = await relayed.catch((error) => failed(error instanceof Error ? error.message : String(error)));
        respond(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
    };
    let sending = Promise.resolve();
    const forward = (line) => {
        if (!options.relay) {
            child.stdin.write(line + "\n");
            return;
        }
        sending = sending.then(() => send(line)).catch(() => { });
        return sending;
    };
    const intercept = createMcpBridgeInterceptor({
        answer,
        forward,
        ...(client ? { gate: { check: (frame) => client.state(true, options.gate?.describe?.(frame)) } } : {}),
    });
    let pendingInput = Promise.resolve();
    const inbound = createLineSplitter((line) => {
        toolLists.observeRequest(line);
        tap?.request(line);
        const completion = intercept(line);
        if (completion)
            pendingInput = completion;
    });
    const onStdin = (chunk) => inbound.push(chunk);
    process.stdin.on("data", onStdin);
    process.stdin.on("end", () => {
        inbound.flush();
        // A final tools/call may still await the gate: close the far end only after it is forwarded.
        void pendingInput.finally(() => child.stdin.end());
    });
    const outbound = createLineSplitter((line) => {
        if (!children.take(line))
            respond(line);
    });
    child.stdout.on("data", (chunk) => outbound.push(chunk));
    child.stdout.on("end", () => outbound.flush());
    const detach = () => {
        process.stdin.off("data", onStdin);
        process.stdin.pause();
    };
    let watchdog = null;
    if (options.liveness) {
        const liveness = options.liveness;
        watchdog = createInactivityWatchdog({
            inactivityMs: BRIDGE_INACTIVITY_MS,
            probe: () => runLivenessProbe(liveness, PROBE_TIMEOUT_MS, options.env),
            onDead: () => {
                process.stderr.write(`${options.label} transport went silent and stopped answering liveness probes; ending the bridge\n`);
                process.exitCode = 1;
                detach();
                child.kill("SIGKILL");
                // A docker wedged on a dead ssh link may never deliver close; after 45 quiet seconds nothing is buffered to truncate.
                const failsafe = setTimeout(() => process.exit(1), 2_000);
                failsafe.unref?.();
            },
        });
        const touch = () => watchdog?.touch();
        process.stdin.on("data", touch);
        child.stdout.on("data", touch);
        child.stderr.on("data", touch);
    }
    child.on("error", (error) => {
        process.stderr.write(`could not connect to ${options.label}: ${error.message}\n`);
        process.exitCode = 1;
        watchdog?.stop();
        children.close();
        detach();
    });
    child.on("close", (code, signal) => {
        if (signal)
            process.stderr.write(`${options.label} connection ended with ${signal}\n`);
        // process.exit() here would discard buffered stdout mid-frame: set exitCode and let stdio drain.
        process.exitCode = process.exitCode ?? code ?? 1;
        watchdog?.stop();
        children.close();
        detach();
    });
    for (const signal of ["SIGTERM", "SIGINT"]) {
        process.on(signal, () => child.kill(signal));
    }
}
