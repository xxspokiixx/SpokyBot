// Windows differences for agent CLIs: CreateProcess cannot exec .cmd/.bat shims or shebang scripts (env-path
// resolves them without a shell), there is no process-group kill (taskkill /T), GUI-spawned consoles flash without
// windowsHide, and the command line is capped at 32,767 characters (prompts go on stdin or in files).
import { spawn, execFile, } from "node:child_process";
import { closeSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { botBox } from "./bot-box/box.js";
import { engineMemory } from "./engine-memory.js";
import { engineHomes } from "./engine-homes/engine-homes.js";
import { resolveCliSpawn } from "./env-path.js";
import { spawnBotWork } from "./oom-score.js";
export function resolveCli(cli, args = [], env) {
    return resolveCliSpawn(cli, args, env);
}
/** Headroom below CreateProcess' 32,767 UTF-16 code-unit limit for libuv's quoting and executable expansion. */
export const WINDOWS_SAFE_COMMAND_LINE_CHARS = 30_000;
export function estimatedWindowsCommandLineChars(resolved) {
    return [resolved.command, ...resolved.args].reduce((total, value) => total + JSON.stringify(value).length + 1, 0);
}
export function assertSafeCliArgv(resolved, platform = process.platform) {
    if (platform !== "win32")
        return;
    if (estimatedWindowsCommandLineChars(resolved) <= WINDOWS_SAFE_COMMAND_LINE_CHARS)
        return;
    const error = new Error("agent CLI launch arguments exceed Windows' safe command-line limit; pass large prompts through stdin or a file");
    error.code = "ENAMETOOLONG";
    throw error;
}
// Only spawnCli makes a private POSIX group; a plain child may share ours, so never signal its group.
const cliGroups = new WeakSet();
const stopping = new WeakMap();
const linuxTrees = new WeakMap();
function linuxProcess(pid) {
    let stat;
    try {
        stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    }
    catch (error) {
        if (["ENOENT", "ESRCH"].includes(error.code ?? ""))
            return null;
        throw error;
    }
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const start = fields[19];
    const state = fields[0];
    const parent = Number(fields[1]);
    if (!start || !state || !Number.isInteger(parent))
        throw new Error("Unreadable Linux process identity");
    return { pid, parent, start, state };
}
/** Linux sandbox helpers can leave the CLI's process group and reparent during a protocol interrupt. */
export function captureCliTree(child) {
    if (process.platform !== "linux" || !cliGroups.has(child) || !child.pid)
        return;
    let tree = linuxTrees.get(child);
    if (!tree) {
        tree = new Map();
        linuxTrees.set(child, tree);
    }
    const snapshot = new Map();
    let entries;
    try {
        entries = readdirSync("/proc");
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (!/^\d+$/.test(entry))
            continue;
        const pid = Number(entry);
        try {
            const current = linuxProcess(pid);
            if (current)
                snapshot.set(pid, current);
        }
        catch { }
    }
    const parents = new Set([...tree].filter(([pid, start]) => snapshot.get(pid)?.start === start).map(([pid]) => pid));
    let discovered;
    do {
        discovered = false;
        for (const current of snapshot.values()) {
            if (current.pid === process.pid || !parents.has(current.parent) || tree.get(current.pid) === current.start)
                continue;
            tree.set(current.pid, current.start);
            parents.add(current.pid);
            discovered = true;
        }
    } while (discovered);
}
function linuxDescendantsStopped(child) {
    for (const [pid, start] of linuxTrees.get(child) ?? []) {
        if (pid === child.pid)
            continue;
        try {
            const current = linuxProcess(pid);
            if (current?.start === start && current.state !== "Z" && current.state !== "X")
                return false;
        }
        catch {
            return false;
        }
    }
    return true;
}
function linuxRootIdentityMatches(child) {
    const start = child.pid && linuxTrees.get(child)?.get(child.pid);
    if (!child.pid || process.platform !== "linux" || !cliGroups.has(child))
        return true;
    if (!start)
        return undefined;
    try {
        const current = linuxProcess(child.pid);
        return !current || current.start === start;
    }
    catch {
        return undefined;
    }
}
function signalLinuxDescendants(child, value) {
    for (const [pid, start] of [...(linuxTrees.get(child) ?? [])].reverse()) {
        if (pid === child.pid || pid <= 1 || pid === process.pid)
            continue;
        try {
            const current = linuxProcess(pid);
            if (current?.start === start && current.state !== "Z" && current.state !== "X")
                process.kill(pid, value);
        }
        catch { }
    }
}
const MAX_ENDED_SESSIONS = 4_096;
const engineSessions = { live: new Set(), ended: new Set() };
/** POSIX session ids of the engines that run bots' turns (each leads its own session). A server opened by any
 * process in one counts as the bot's, even after the shell that started it exits. */
export function botEngineSessions() {
    return engineSessions;
}
function rememberEngineSession(child) {
    const pid = child.pid;
    if (!pid)
        return;
    engineSessions.live.add(pid);
    child.once("exit", () => {
        engineSessions.live.delete(pid);
        engineSessions.ended.add(pid);
        if (engineSessions.ended.size > MAX_ENDED_SESSIONS)
            engineSessions.ended.delete(engineSessions.ended.values().next().value);
    });
}
/** The box for this spawn, or null when it runs as is. A spawn in an engine home has that home in place of HOME. */
export function boxedSpawn(resolved, opts, owner, homed = null) {
    if (opts.box === false || (owner !== "bot" && !opts.box))
        return null;
    const request = typeof opts.box === "object" ? opts.box : {};
    const home = homed ? { home: homed.home, shared: homed.shared } : {};
    return botBox.wrap({ command: resolved.command, args: resolved.args, cwd: typeof opts.cwd === "string" ? opts.cwd : undefined, env: opts.env ?? process.env, ...request, ...home });
}
export function spawnCli(cli, args, opts, owner = "openmausbot") {
    const resolved = resolveCli(cli, args);
    assertSafeCliArgv(resolved);
    const homed = owner === "bot" || opts.engineHome ? engineHomes.forSpawn(opts.env ?? process.env) : null;
    const options = homed ? { ...opts, env: homed.env } : opts;
    const boxed = boxedSpawn(resolved, options, owner, homed);
    const { box: _box, engineHome: _engineHome, botWork, ...spawnOpts } = options;
    // The box's extra descriptors (its seccomp filter) follow stdio; only a plain three-entry stdio can take them.
    const stdio = boxed?.extraFds.length && Array.isArray(spawnOpts.stdio) && spawnOpts.stdio.length === 3 ? [...spawnOpts.stdio, ...boxed.extraFds] : spawnOpts.stdio;
    const start = () => spawn(boxed?.command ?? resolved.command, boxed?.args ?? resolved.args, {
        ...spawnOpts,
        ...(boxed ? { env: boxed.env, stdio } : {}),
        // POSIX: own group so kill(-pid) reaps child MCP servers; Windows: taskkill /T does it.
        ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
    });
    let child;
    try {
        child = owner === "bot" || botWork ? spawnBotWork(start) : start();
    }
    finally {
        for (const fd of boxed?.extraFds ?? [])
            try {
                closeSync(fd);
            }
            catch { }
    }
    // The broker token minted for this process dies with it.
    if (boxed?.token)
        child.once("exit", boxed.release);
    if (process.platform !== "win32")
        cliGroups.add(child);
    if (process.platform === "linux" && child.pid) {
        const tree = new Map();
        try {
            const root = linuxProcess(child.pid);
            if (root)
                tree.set(root.pid, root.start);
        }
        catch { }
        linuxTrees.set(child, tree);
    }
    if (process.platform !== "win32" && owner === "bot") {
        rememberEngineSession(child);
        engineMemory.track(child);
    }
    // On Windows a stdin write between taskkill and pipe close errors asynchronously; unlistened, that crashes the harness.
    child.stdin?.on("error", () => { });
    return child;
}
const EXEC_KILL_GRACE_MS = 2_000;
export function execCli(cli, args, opts, cb) {
    const resolved = resolveCli(cli, args);
    try {
        assertSafeCliArgv(resolved);
    }
    catch (error) {
        queueMicrotask(() => cb(error instanceof Error ? error : new Error(String(error)), "", ""));
        return;
    }
    let escalate;
    const child = execFile(resolved.command, resolved.args, { ...opts, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
        clearTimeout(escalate);
        cb(err, stdout, stderr);
    });
    // Node (24) calls back only once the child exits, and a CLI wrapper that traps SIGTERM outlives the timeout's signal.
    // Only the child is stopped: execFile starts no process group, so a grandchild that ignores SIGTERM can outlive it.
    if (opts.timeout) {
        escalate = setTimeout(() => void killCliTree(child, 0), opts.timeout + EXEC_KILL_GRACE_MS);
        escalate.unref?.();
    }
}
/** Concurrent probes on a busy machine can outlast the timeout, so a CLI that answered before keeps its last version. */
export function cliVersionReader(cli) {
    let last = null;
    return (err, stdout) => {
        const version = err ? "" : stdout.trim();
        if (version)
            return { version: (last = version) };
        const failure = err;
        const timedOut = failure?.killed === true && typeof failure.code !== "string";
        if (timedOut && last)
            return { version: last };
        return { reason: timedOut ? `\`${cli}\` took longer than 8 seconds to answer --version. The machine may be busy; check again.` : `\`${cli}\` CLI not found` };
    };
}
export function describeSpawnFailure(err, cli, cwd) {
    if (err.code === "ENOENT") {
        if (cwd && !existsSync(cwd))
            return { message: `This chat's working folder no longer exists: ${cwd}. Choose another folder in the bot's settings, or create it again.`, setup: false };
        return { message: `\`${cli}\` isn't installed, or isn't on this app's PATH`, setup: true };
    }
    if (err.code === "EACCES" || err.code === "EPERM")
        return { message: `\`${cli}\` isn't executable — check its file permissions`, setup: true };
    if (err.code === "ENAMETOOLONG")
        return {
            message: `\`${cli}\` received too much launch data for Windows; update this provider or pass its prompt through stdin/a file`,
            setup: false,
        };
    return { message: `spawn failed: ${err.message}`, setup: false };
}
/** timeoutMs is the TERM grace; SIGKILL gets one more second. Linux also stops captured detached descendants. */
export function killCliTree(child, timeoutMs = 5_000) {
    const existing = stopping.get(child);
    if (existing)
        return existing;
    const pid = child.pid;
    if (!pid)
        return Promise.resolve(true);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid)
        return Promise.resolve(false);
    captureCliTree(child);
    const run = stopCliTree(child, pid, Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 5_000);
    stopping.set(child, run);
    // Remember success, so a delayed caller cannot signal a reused PID/group.
    void run.then((stopped) => { if (!stopped)
        stopping.delete(child); });
    return run;
}
async function stopCliTree(child, pid, timeoutMs) {
    const exited = () => child.exitCode !== null || child.signalCode !== null;
    if (process.platform !== "win32") {
        const group = cliGroups.has(child);
        const settled = () => {
            if (!exited() || !linuxDescendantsStopped(child))
                return false;
            if (!group || linuxRootIdentityMatches(child) === false)
                return true;
            if (linuxRootIdentityMatches(child) === undefined)
                return false;
            try {
                process.kill(-pid, 0);
                return false;
            }
            catch (error) {
                // EPERM and other failures do not prove that the group is gone.
                return error.code === "ESRCH";
            }
        };
        const signal = (value) => {
            captureCliTree(child);
            signalLinuxDescendants(child, value);
            try {
                if (group && (!exited() || linuxRootIdentityMatches(child) === true))
                    process.kill(-pid, value);
                else if (!group && !exited())
                    child.kill(value);
            }
            catch {
                if (!exited()) {
                    try {
                        child.kill(value);
                    }
                    catch { }
                }
            }
        };
        const wait = async (ms) => {
            const deadline = Date.now() + ms;
            while (!settled()) {
                const remaining = deadline - Date.now();
                if (remaining <= 0) {
                    // Timers run before libuv's poll phase reads SIGCHLD: a blocked loop reaches the deadline with the exit unread.
                    await new Promise((resolve) => setImmediate(resolve));
                    return settled();
                }
                await exitOrDelay(child, Math.min(25, remaining));
            }
            return true;
        };
        if (settled())
            return true;
        signal("SIGTERM");
        if (await wait(timeoutMs))
            return true;
        signal("SIGKILL");
        return wait(1_000);
    }
    if (exited())
        return true;
    return new Promise((resolve) => {
        let timer;
        let finished = false;
        const done = (stopped) => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timer);
            child.off("close", closed);
            child.off("exit", closed);
            resolve(stopped);
        };
        const closed = () => done(true);
        child.once("close", closed);
        timer = setTimeout(() => done(false), timeoutMs);
        timer.unref?.();
        execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (err) => {
            if (finished)
                return;
            if (!err) {
                // taskkill can finish before Node sees the exit, and callers may rename the executable at once: wait for both, not for inherited pipes.
                if (exited())
                    done(true);
                else
                    child.once("exit", closed);
                return;
            }
            try {
                child.kill();
            }
            catch {
            }
        });
    });
}
function exitOrDelay(child, ms) {
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            child.off("exit", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        child.once("exit", done);
    });
}
/** True once the process itself has exited, within `ms`; members it left in its group are not counted. */
export async function waitForExit(child, ms) {
    const exited = () => child.exitCode !== null || child.signalCode !== null;
    const deadline = Date.now() + ms;
    while (!exited() && Date.now() < deadline)
        await exitOrDelay(child, Math.min(250, deadline - Date.now()));
    if (!exited())
        await new Promise((resolve) => setImmediate(resolve));
    return exited();
}
/** Unix socket on POSIX, named pipe on Windows (Node cannot listen on a filesystem socket path there: EACCES). */
export function brokerSocketPath(dataDir, tag) {
    return process.platform === "win32"
        // Named pipes share a global namespace that DATA_DIR cannot isolate.
        ? `\\\\.\\pipe\\openmausbot-perm-${process.pid}-${tag}`
        : join(dataDir, `perm-${tag}.sock`);
}
