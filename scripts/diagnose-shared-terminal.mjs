// Bounded Windows-only release diagnosis. Runs fixed, harmless commands only.
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform !== "win32") process.exit(0);
const root = await mkdtemp(path.join(tmpdir(), "omb-terminal-diagnosis-"));
await mkdir(path.join(root, "AppData", "Local"), { recursive: true });
await mkdir(path.join(root, "AppData", "Roaming"), { recursive: true });
const baseline = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "LANG"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
baseline.HOME = root; baseline.USERPROFILE = root;
const fixed = { ...baseline, APPDATA: path.join(root, "AppData", "Roaming"), LOCALAPPDATA: path.join(root, "AppData", "Local"), ProgramFiles: process.env.ProgramFiles, ProgramData: process.env.ProgramData, COMSPEC: process.env.COMSPEC };
const command = "echo shared-desktop-ok";
const trials = [
  { name: "baseline", env: baseline, args: ["-Command", command] },
  { name: "appdata", env: fixed, args: ["-Command", command] },
  { name: "text-output", env: baseline, args: ["-OutputFormat", "Text", "-Command", command] },
  { name: "closed-pipe", env: baseline, args: ["-Command", command], pipe: true },
  { name: "literal-output", env: baseline, args: ["-Command", "'shared-desktop-ok'"] },
];
try {
  await Promise.all(trials.map(trial => new Promise(resolve => {
    const started = Date.now(); let output = ""; let timedOut = false; let exited = false;
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", ...trial.args], { cwd: root, env: trial.env, windowsHide: true, stdio: [trial.pipe ? "pipe" : "ignore", "pipe", "pipe"] });
    if (trial.pipe) child.stdin.end();
    child.stdout.on("data", data => { output += data; });
    child.stderr.resume();
    child.on("exit", () => { exited = true; });
    const timer = setTimeout(() => {
      timedOut = true;
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("error", () => child.kill());
    }, 15_000);
    child.on("error", error => { clearTimeout(timer); console.log(JSON.stringify({ name: trial.name, error: error.code })); resolve(); });
    child.on("close", code => { clearTimeout(timer); console.log(JSON.stringify({ name: trial.name, elapsedMs: Date.now() - started, code, timedOut, exited, marker: output.includes("shared-desktop-ok") })); resolve(); });
  })));
} finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
