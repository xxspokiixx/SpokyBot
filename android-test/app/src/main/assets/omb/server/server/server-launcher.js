// Container entry: restarts the server in place on RESTART_EXIT_CODE, since a container restart cuts off a Caddy sharing its network.
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boxMemory, heapSizeArgs } from "./box-memory.js";
import { restartPolicy } from "./restart.js";
/** The server's heap sized to the container's memory limit, run through the bootstrap that keeps Node's compile cache on
 * the data volume, so a restarted container reuses the compiled bundle. */
export function serverCommand(here, env, options = {}) {
    const bootstrap = join(here, "desktop-entry.mjs");
    const cached = (options.exists ?? existsSync)(bootstrap);
    const dataDir = env.OMB_DATA_DIR || join(homedir(), ".openmausbot");
    return {
        args: [...heapSizeArgs((options.box ?? boxMemory()).cgroupLimit, env.NODE_OPTIONS), cached ? bootstrap : join(here, "index.js")],
        env: cached ? { ...env, OMB_SERVER_COMPILE_CACHE: join(dataDir, "cache", "node-compile") } : env,
    };
}
export function superviseServer(start, options = {}) {
    const signals = options.signals ?? process, now = options.now ?? Date.now;
    return new Promise((done) => {
        let child, stopping = false;
        const policy = restartPolicy(now);
        const pass = (signal) => () => { stopping = true; child.kill(signal); };
        const onTerm = pass("SIGTERM"), onInt = pass("SIGINT");
        const finish = (code) => { signals.off("SIGTERM", onTerm); signals.off("SIGINT", onInt); done(code); };
        const run = () => {
            child = start();
            child.once("error", () => finish(1));
            child.once("exit", (code, signal) => {
                if (policy.again(code, stopping)) {
                    console.log("SpokyBot is starting again to finish installing a copy from the desktop app…");
                    run();
                    return;
                }
                finish(code ?? (stopping && (signal === "SIGTERM" || signal === "SIGINT") ? 0 : 1));
            });
        };
        signals.on("SIGTERM", onTerm);
        signals.on("SIGINT", onInt);
        run();
    });
}
/** Node names the entry by its real path, so compare real paths (a macOS temp folder is reached through a link). */
function isEntry() {
    try {
        return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
    }
    catch {
        return false;
    }
}
if (isEntry()) {
    const server = serverCommand(dirname(fileURLToPath(import.meta.url)), process.env);
    void superviseServer(() => spawn(process.execPath, server.args, { stdio: "inherit", env: server.env })).then((code) => { process.exitCode = code; });
}
