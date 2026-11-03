#!/usr/bin/env node
// The phone's "this computer": a minimal MCP stdio server whose tools run inside
// the proot'ed Debian rootfs (see android-test/runtime/android-arm64/linux/).
// The harness gate (local-computer-proxy) launches it as: <node> <this file> mcp
// with OMB_ANDROID_LINUX_DIR / OMB_ANDROID_ROOTFS / OMB_ANDROID_WORKSPACE / OMB_ANDROID_TMP_DIR in env.
// Supports both headless mode (bash, read_file, write_file, list_files) and
// graphical mode (start_graphical_desktop, get_desktop_url, screenshot).
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const LINUX = process.env.OMB_ANDROID_LINUX_DIR ?? "";
const ROOTFS = process.env.OMB_ANDROID_ROOTFS ?? join(LINUX, "rootfs");
const WORKSPACE = process.env.OMB_ANDROID_WORKSPACE ?? "";
const DATA_DIR = process.env.OMB_ANDROID_DATA_DIR ?? "";
const TMP_DIR = process.env.OMB_ANDROID_TMP_DIR ?? join(LINUX, "tmp");

const TOOL_TIMEOUT_MS = 120_000;

// Track graphical desktop state
let graphicalDesktopPid = null;
let graphicalDesktopUrl = null;

const TOOLS = [
  {
    name: "bash",
    description: "Run a shell command in this computer's Linux environment (Debian, bash). The working directory is /work, the bot's workspace; app data is mounted at /data (use /data/task-workspaces/... for bot files).",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to run, e.g. `python3 script.py` or `ls -la`." },
        timeoutMs: { type: "integer", description: `Optional wall-clock limit in milliseconds, up to ${TOOL_TIMEOUT_MS}.` },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a text file from this computer. Paths resolve against /work when relative; app data is at /data.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "File path, absolute inside the Linux env or relative to /work." } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a text file on this computer. Paths resolve against /work when relative. Parent folders are created. App data is at /data.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, absolute inside the Linux env or relative to /work." },
        content: { type: "string", description: "Full file contents to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List a folder on this computer. Paths resolve against /work when relative; app data is at /data.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Folder path; defaults to /work." } },
    },
  },
  // Graphical desktop tools (available when rootfs has X11/VNC stack)
  {
    name: "start_graphical_desktop",
    description: "Start the graphical desktop (Xvfb + openbox + x11vnc + noVNC) in the Linux environment. Returns the noVNC URL for browser access.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "integer", description: "Screen width (default: 1920)", default: 1920 },
        height: { type: "integer", description: "Screen height (default: 1080)", default: 1080 },
        depth: { type: "integer", description: "Color depth (default: 24)", default: 24 },
      },
    },
  },
  {
    name: "get_desktop_url",
    description: "Get the noVNC URL for the running graphical desktop.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the graphical desktop (requires graphical desktop to be running).",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["png", "jpeg"], description: "Image format (default: png)", default: "png" },
      },
    },
  },
];

// Android's kernel resolves a guest binary's PT_INTERP at the host root, where
// the rootfs loader does not exist, so guest programs exec through proot's
// loader instead (PROOT_LOADER, a real file since Android denies memfd exec to
// apps): it maps the binary and its interpreter itself, from the rootfs.
// copyAssetDir strips modes, so the app restores the loader's exec bit before
// any of this can run.
function guestCommand(bashArgs) {
  const args = [
    join(LINUX, "proot"),
    "-R", ROOTFS,
    "-b", `${WORKSPACE}:/work`,
  ];
  if (DATA_DIR) args.push("-b", `${DATA_DIR}:/data`);
  args.push("-w", "/work", ...bashArgs);
  return args;
}

function runGuest(argv, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      env: {
        // The guest inherits this env: give it the guest's own PATH, not
        // Android's; LD_LIBRARY_PATH must name only proot's two bionic libs,
        // which no guest binary depends on by name.
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: "/root",
        TMPDIR: TMP_DIR,
        LD_LIBRARY_PATH: LINUX,
        PROOT_TMP_DIR: TMP_DIR,
        PROOT_NO_SECCOMP: "1",
        PROOT_ASSUME_MEMFD_UNSUPPORTED: "1",
        PROOT_LOADER: join(LINUX, "loader"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let done = false;
    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, signal, out });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(-1, "SIGKILL");
    }, Math.min(timeoutMs, TOOL_TIMEOUT_MS));
    child.stdout.setEncoding("utf8").on("data", (chunk) => { out += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { out += chunk; });
    child.on("error", (error) => {
      out += `\n${error}`;
      finish(-1, undefined);
    });
    child.on("close", finish);
  });
}

function normalizePath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "/work";
  // Already a guest path.
  if (raw === "/data" || raw.startsWith("/data/")) return raw;
  if (raw === "/work" || raw.startsWith("/work/")) return raw;
  // Host path under the mounted app data dir: map to /data.
  if (DATA_DIR && (raw === DATA_DIR || raw.startsWith(DATA_DIR + "/") || raw.startsWith(DATA_DIR + "\\"))) {
    const rel = raw.slice(DATA_DIR.length).replace(/\\/g, "/").replace(/^\/+/, "");
    return rel ? `/data/${rel}` : "/data";
  }
  // Android app-data path containing files/data: map the suffix.
  const marker = "/files/data/";
  const idx = raw.replace(/\\/g, "/").indexOf(marker);
  if (idx >= 0) {
    const rel = raw.replace(/\\/g, "/").slice(idx + marker.length).replace(/^\/+/, "");
    return rel ? `/data/${rel}` : "/data";
  }
  return raw;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function callTool(name, input) {
  let bashArgs;
  if (name === "bash") {
    const limit = Number.isInteger(input?.timeoutMs) ? input.timeoutMs : TOOL_TIMEOUT_MS;
    bashArgs = ["/bin/bash", "-lc", String(input?.command ?? "")];
    const run = await runGuest(guestCommand(bashArgs), limit);
    const text = (run.out || "(no output)").trim();
    return { content: [{ type: "text", text }], isError: run.code !== 0 };
  }
  if (name === "read_file") {
    const path = normalizePath(input?.path ?? "/work");
    bashArgs = ["/bin/bash", "-lc", `cat -- ${shellQuote(path)}`];
    const run = await runGuest(guestCommand(bashArgs), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out }], isError: run.code !== 0 };
  }
  if (name === "write_file") {
    const path = normalizePath(input?.path ?? "");
    const content = String(input?.content ?? "");
    mkdirSync(WORKSPACE, { recursive: true });
    bashArgs = ["/bin/bash", "-lc", `mkdir -p -- "$(dirname -- ${shellQuote(path)})" && printf %s ${shellQuote(content)} > ${shellQuote(path)} && echo "wrote ${path}"`];
    const run = await runGuest(guestCommand(bashArgs), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: (run.out || "").trim() || (run.code === 0 ? "wrote" : "write failed") }], isError: run.code !== 0 };
  }
  if (name === "list_files") {
    const path = input?.path === undefined || input?.path === "" ? "/work" : normalizePath(input.path);
    bashArgs = ["/bin/bash", "-lc", `ls -la -- ${shellQuote(path)}`];
    const run = await runGuest(guestCommand(bashArgs), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out }], isError: run.code !== 0 };
  }

  // Graphical desktop tools
  if (name === "start_graphical_desktop") {
    const _width = input?.width ?? 1920;
    const _height = input?.height ?? 1080;
    const _depth = input?.depth ?? 24;

    // Check if graphical desktop is already running
    if (graphicalDesktopPid) {
      return { content: [{ type: "text", text: `Graphical desktop already running at ${graphicalDesktopUrl}` }], isError: false };
    }

    // Check if start-graphical-desktop script exists in rootfs
    const scriptPath = join(ROOTFS, "usr", "local", "bin", "start-graphical-desktop");
    if (!existsSync(scriptPath)) {
      return { content: [{ type: "text", text: "Graphical desktop not available: start-graphical-desktop script not found in rootfs. Build the arm64 rootfs with X11/VNC stack first." }], isError: true };
    }

    // Start the graphical desktop in background
    const bashArgs = ["/usr/local/bin/start-graphical-desktop"];
    const run = await runGuest(guestCommand(bashArgs), 30000); // 30 second timeout for startup

    // The script runs in background, so we need to capture the noVNC URL
    // noVNC runs on port 6080 inside the proot environment
    // We'll use a fixed URL since the port is known
    graphicalDesktopUrl = `http://localhost:6080/vnc.html`;

    // Extract PID from output if available
    const pidMatch = run.out.match(/XVFB_PID=(\d+)/);
    if (pidMatch) {
      graphicalDesktopPid = pidMatch[1];
    }

    return {
      content: [{
        type: "text",
        text: `Graphical desktop started!\nnoVNC URL: ${graphicalDesktopUrl}\nXvfb PID: ${graphicalDesktopPid || "unknown"}\n\nConnect via browser or use the noVNC client.`
      }],
      isError: run.code !== 0
    };
  }

  if (name === "get_desktop_url") {
    if (!graphicalDesktopUrl) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    return { content: [{ type: "text", text: graphicalDesktopUrl }], isError: false };
  }

  if (name === "screenshot") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }

    const format = input?.format ?? "png";
    const outputPath = `/tmp/screenshot.${format}`;

    // Use xwd to capture screenshot from Xvfb
    bashArgs = ["/bin/bash", "-lc", `DISPLAY=:1 xwd -root -out ${shellQuote(outputPath)} && ls -la ${shellQuote(outputPath)}`];
    const run = await runGuest(guestCommand(bashArgs), TOOL_TIMEOUT_MS);

    if (run.code !== 0) {
      return { content: [{ type: "text", text: `Screenshot failed: ${run.out}` }], isError: true };
    }

    return { content: [{ type: "text", text: `Screenshot saved to ${outputPath}\n${run.out}` }], isError: false };
  }

  return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return; // notification
  const { method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openmausbot-android-local-computer", version: "1.1.0" },
      },
    });
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    callTool(String(params?.name ?? ""), params?.arguments ?? {})
      .then((result) => send({ jsonrpc: "2.0", id: message.id, result }))
      .catch((error) => send({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: String(error?.stack ?? error) }], isError: true },
      }));
    return;
  }
  if (method === "resources/list" || method === "prompts/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { resources: [], prompts: [] } });
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${method}` } });
}

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
});