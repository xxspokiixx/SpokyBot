import { createRequire as __ombCreateRequire } from "node:module";
const require = __ombCreateRequire(import.meta.url);

// server/server-launcher.ts
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// server/restart.ts
var RESTART_EXIT_CODE = 75;
var MAX_RESTARTS = 5;
var STABLE_RUN_MS = 6e4;
function restartPolicy(now = Date.now) {
  let restarts = 0, startedAt = now();
  return {
    again(code, stopping = false) {
      if (now() - startedAt >= STABLE_RUN_MS) restarts = 0;
      if (stopping || code !== RESTART_EXIT_CODE || restarts >= MAX_RESTARTS) return false;
      restarts++;
      startedAt = now();
      return true;
    }
  };
}

// server/server-launcher.ts
function superviseServer(start, options = {}) {
  const signals = options.signals ?? process, now = options.now ?? Date.now;
  return new Promise((done) => {
    let child, stopping = false;
    const policy = restartPolicy(now);
    const pass = (signal) => () => {
      stopping = true;
      child.kill(signal);
    };
    const onTerm = pass("SIGTERM"), onInt = pass("SIGINT");
    const finish = (code) => {
      signals.off("SIGTERM", onTerm);
      signals.off("SIGINT", onInt);
      done(code);
    };
    const run = () => {
      child = start();
      child.once("error", () => finish(1));
      child.once("exit", (code, signal) => {
        if (policy.again(code, stopping)) {
          console.log("SpokyBot is starting again to finish installing a copy from the desktop app\u2026");
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
function isEntry() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
}
if (isEntry()) {
  const server = join(dirname(fileURLToPath(import.meta.url)), "index.js");
  void superviseServer(() => spawn(process.execPath, [server], { stdio: "inherit" })).then((code) => {
    process.exitCode = code;
  });
}
export {
  superviseServer
};
