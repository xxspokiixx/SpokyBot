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

// Ensure opencode binary is available in rootfs
async function ensureOpenCodeInRootfs() {
  const sourceBinary = join(LINUX, "opencode");
  const targetBinary = join(ROOTFS, "usr", "local", "bin", "opencode");
  if (existsSync(sourceBinary) && !existsSync(targetBinary)) {
    try {
      const { copyFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(join(ROOTFS, "usr", "local", "bin"), { recursive: true });
      copyFileSync(sourceBinary, targetBinary);
      const { chmodSync } = await import("node:fs");
      chmodSync(targetBinary, 0o755);
      console.error("android-local-computer: copied opencode to rootfs /usr/local/bin");
    } catch (e) {
      console.error("android-local-computer: failed to copy opencode to rootfs:", e);
    }
  }
}

// Track graphical desktop state
let graphicalDesktopPid = null;
let graphicalDesktopUrl = null;

// Initialize opencode in rootfs on startup
ensureOpenCodeInRootfs().catch(() => {});

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
    name: "setup_graphical_desktop",
    description: "Install X11/VNC packages to enable a graphical desktop. Run this once before using start_graphical_desktop. Downloads ~100MB of packages.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "start_graphical_desktop",
    description: "Start the graphical desktop (Xvfb + XFCE + x11vnc + noVNC) in the Linux environment. Returns the noVNC URL for browser access.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "integer", description: "Screen width (default: 1600)", default: 1600 },
        height: { type: "integer", description: "Screen height (default: 1000)", default: 1000 },
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
  // Mouse interaction tools
  {
    name: "mouse_move",
    description: "Move the mouse cursor to specific coordinates on the graphical desktop.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "integer", description: "X coordinate (0-1919)" },
        y: { type: "integer", description: "Y coordinate (0-1079)" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "mouse_click",
    description: "Click the mouse at the current position or specified coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "integer", description: "Optional X coordinate" },
        y: { type: "integer", description: "Optional Y coordinate" },
        button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button (default: left)", default: "left" },
        count: { type: "integer", description: "Click count (default: 1)", default: 1 },
      },
    },
  },
  {
    name: "mouse_drag",
    description: "Drag the mouse from one position to another.",
    inputSchema: {
      type: "object",
      properties: {
        start_x: { type: "integer", description: "Starting X coordinate" },
        start_y: { type: "integer", description: "Starting Y coordinate" },
        end_x: { type: "integer", description: "Ending X coordinate" },
        end_y: { type: "integer", description: "Ending Y coordinate" },
        button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button to hold (default: left)", default: "left" },
      },
      required: ["start_x", "start_y", "end_x", "end_y"],
    },
  },
  // Keyboard interaction tools
  {
    name: "keyboard_type",
    description: "Type text on the graphical desktop.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to type" },
        delay: { type: "integer", description: "Delay between keystrokes in ms (default: 50)", default: 50 },
      },
      required: ["text"],
    },
  },
  {
    name: "keyboard_key",
    description: "Press a single key on the graphical desktop.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key to press (e.g., Return, Escape, Tab, BackSpace, Delete, Up, Down, Left, Right, F1-F12)" },
      },
      required: ["key"],
    },
  },
  {
    name: "keyboard_hotkey",
    description: "Press a key combination (hotkey) on the graphical desktop.",
    inputSchema: {
      type: "object",
      properties: {
        keys: { type: "array", items: { type: "string" }, description: "Keys to press simultaneously (e.g., ['ctrl', 'c'], ['alt', 'tab'], ['super', 'd'])" },
      },
      required: ["keys"],
    },
  },
  // Clipboard tools
  {
    name: "clipboard_get",
    description: "Get the current clipboard content from the graphical desktop.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "clipboard_set",
    description: "Set the clipboard content on the graphical desktop.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to put in clipboard" },
      },
      required: ["text"],
    },
  },
];

// Android's kernel resolves a guest binary's PT_INTERP at the host root, where
// the rootfs loader does not exist, so guest programs exec through proot's
// loader instead (PROOT_LOADER, a real file since Android denies memfd exec to
// apps): it maps the binary and its interpreter itself, from the rootfs.
// copyAssetDir strips modes, so the app restores the loader's exec bit before
// any of this can run.
function guestCommand(bashArgs, { fakeRoot = false, bindTmp = false } = {}) {
  const args = [
    join(LINUX, "proot"),
    "-R", ROOTFS,
    "-b", `${WORKSPACE}:/work`,
    "-b", `${LINUX}:/host-linux`,
  ];
  if (bindTmp) args.push("-b", `${LINUX}/tmp:/tmp`);
  if (DATA_DIR) args.push("-b", `${DATA_DIR}:/data`);
  if (fakeRoot) args.push("-0");
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
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/host-linux",
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
  if (name === "setup_graphical_desktop") {
    // Check if already set up
    const scriptPath = join(ROOTFS, "usr", "local", "bin", "start-graphical-desktop");
    if (existsSync(scriptPath)) {
      return { content: [{ type: "text", text: "Graphical desktop already set up. Use start_graphical_desktop to launch it." }], isError: false };
    }
    // Run the setup script (long timeout for package download)
    const setupScript = join(LINUX, "setup-graphical-desktop.sh");
    if (!existsSync(setupScript)) {
      return { content: [{ type: "text", text: "Setup script not found. The graphical desktop requires X11/VNC packages to be installed in the rootfs." }], isError: true };
    }
    const bashArgs = ["/bin/bash", "/host-linux/setup-graphical-desktop.sh"];
    const run = await runGuest(guestCommand(bashArgs, { fakeRoot: true }), 600000); // 10 minute timeout for apt install
    return { content: [{ type: "text", text: run.out || (run.code === 0 ? "Setup complete" : "Setup failed") }], isError: run.code !== 0 };
  }
  if (name === "start_graphical_desktop") {
    const _width = input?.width ?? 1600;
    const _height = input?.height ?? 1000;
    const _depth = input?.depth ?? 24;

    // Check if graphical desktop is already running
    if (graphicalDesktopPid) {
      return { content: [{ type: "text", text: `Graphical desktop already running at ${graphicalDesktopUrl}` }], isError: false };
    }

    // Check if start-graphical-desktop script exists in rootfs
    const scriptPath = join(ROOTFS, "usr", "local", "bin", "start-graphical-desktop");
    if (!existsSync(scriptPath)) {
      return { content: [{ type: "text", text: "Graphical desktop not set up. Run setup_graphical_desktop first to install X11/VNC packages (~100MB download), then start_graphical_desktop to launch it." }], isError: true };
    }

    // The supervisor backgrounds Xvfb/XFCE/x11vnc/websockify and then waits, so a
    // kill on timeout is the expected outcome: the desktop outlives this call.
    await runGuest(guestCommand(
      ["/usr/local/bin/start-graphical-desktop", String(_width), String(_height), String(_depth)],
      { bindTmp: true },
    ), 8000);

    graphicalDesktopUrl = `http://localhost:56082/vnc.html`;
    // Ask the X display's socket and the viewer port, not a process name list: this command's
    // own line carries the daemons' words, so pgrep would always find itself. Bash builtins
    // only, and bindTmp is what makes the guest see the socket Xvfb created under the host tmp.
    const probe = await runGuest(guestCommand(["/bin/bash", "-lc",
      "[ -S /tmp/.X11-unix/X3 ] && (exec 3<>/dev/tcp/127.0.0.1/56082) 2>/dev/null && echo UP || echo DOWN"], { bindTmp: true }), 20000);
    const up = probe.out.includes("UP");
    graphicalDesktopPid = up ? "running" : null;

    return {
      content: [{
        type: "text",
        text: up
          ? `Graphical desktop started!\nnoVNC URL: ${graphicalDesktopUrl}\nDisplay: :3 (${_width}x${_height})\n\nThe Screen panel in SpokyBot now shows this desktop.`
          : "Graphical desktop did not start. Its log is at /tmp/gdesktop.log; the usual cause is a missing X11/VNC package (run setup_graphical_desktop first).",
      }],
      isError: !up,
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
    bashArgs = ["/bin/bash", "-lc", `DISPLAY=:3 xwd -root -out ${shellQuote(outputPath)} && ls -la ${shellQuote(outputPath)}`];
    const run = await runGuest(guestCommand(bashArgs), TOOL_TIMEOUT_MS);

    if (run.code !== 0) {
      return { content: [{ type: "text", text: `Screenshot failed: ${run.out}` }], isError: true };
    }

    return { content: [{ type: "text", text: `Screenshot saved to ${outputPath}\n${run.out}` }], isError: false };
  }

  // Mouse interaction tools
  if (name === "mouse_move") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    const x = input?.x ?? 0;
    const y = input?.y ?? 0;
    bashArgs = ["/bin/bash", "-lc", `DISPLAY=:3 xdotool mousemove ${x} ${y}`];
    const run = await runGuest(guestCommand(bashArgs, { bindTmp: true }), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out || `Mouse moved to ${x},${y}` }], isError: run.code !== 0 };
  }

  if (name === "mouse_click") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    const x = input?.x;
    const y = input?.y;
    const button = input?.button ?? "left";
    const count = input?.count ?? 1;
    const buttonMap = { left: 1, right: 3, middle: 2 };
    const btn = buttonMap[button] ?? 1;
    let cmd = `DISPLAY=:3 xdotool`;
    if (x !== undefined && y !== undefined) {
      cmd += ` mousemove ${x} ${y}`;
    }
    cmd += ` click --repeat ${count} ${btn}`;
    bashArgs = ["/bin/bash", "-lc", cmd];
    const run = await runGuest(guestCommand(bashArgs, { bindTmp: true }), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out || `Mouse ${button} clicked ${count}x` }], isError: run.code !== 0 };
  }

  if (name === "mouse_drag") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    const start_x = input?.start_x ?? 0;
    const start_y = input?.start_y ?? 0;
    const end_x = input?.end_x ?? 0;
    const end_y = input?.end_y ?? 0;
    const button = input?.button ?? "left";
    const buttonMap = { left: 1, right: 3, middle: 2 };
    const btn = buttonMap[button] ?? 1;
    const cmd = `DISPLAY=:3 xdotool mousemove ${start_x} ${start_y} mousedown ${btn} mousemove ${end_x} ${end_y} mouseup ${btn}`;
    bashArgs = ["/bin/bash", "-lc", cmd];
    const run = await runGuest(guestCommand(bashArgs, { bindTmp: true }), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out || `Dragged from ${start_x},${start_y} to ${end_x},${end_y}` }], isError: run.code !== 0 };
  }

  // Keyboard interaction tools
  if (name === "keyboard_type") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    const text = String(input?.text ?? "");
    const delay = input?.delay ?? 50;
    // Escape special characters for xdotool
    const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    bashArgs = ["/bin/bash", "-lc", `DISPLAY=:3 xdotool type --delay ${delay} -- "${escaped}"`];
    const run = await runGuest(guestCommand(bashArgs, { bindTmp: true }), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out || `Typed ${text.length} characters` }], isError: run.code !== 0 };
  }

  if (name === "keyboard_key") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    const key = String(input?.key ?? "");
    bashArgs = ["/bin/bash", "-lc", `DISPLAY=:3 xdotool key -- "${key}"`];
    const run = await runGuest(guestCommand(bashArgs, { bindTmp: true }), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out || `Pressed key: ${key}` }], isError: run.code !== 0 };
  }

  if (name === "keyboard_hotkey") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    const keys = Array.isArray(input?.keys) ? input.keys : [];
    if (keys.length === 0) {
      return { content: [{ type: "text", text: "No keys provided" }], isError: true };
    }
    const keyCombo = keys.join("+");
    bashArgs = ["/bin/bash", "-lc", `DISPLAY=:3 xdotool key -- "${keyCombo}"`];
    const run = await runGuest(guestCommand(bashArgs, { bindTmp: true }), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out || `Pressed hotkey: ${keyCombo}` }], isError: run.code !== 0 };
  }

  // Clipboard tools
  if (name === "clipboard_get") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    // Try xclip first, then xsel
    bashArgs = ["/bin/bash", "-lc", `DISPLAY=:3 xclip -o -selection clipboard 2>/dev/null || DISPLAY=:3 xsel -b 2>/dev/null || echo "Clipboard empty or unavailable"`];
    const run = await runGuest(guestCommand(bashArgs, { bindTmp: true }), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out.trim() }], isError: run.code !== 0 };
  }

  if (name === "clipboard_set") {
    if (!graphicalDesktopPid) {
      return { content: [{ type: "text", text: "Graphical desktop not running. Call start_graphical_desktop first." }], isError: true };
    }
    const text = String(input?.text ?? "");
    // Escape for shell
    const escaped = text.replace(/'/g, "'\\''");
    bashArgs = ["/bin/bash", "-lc", `printf %s '${escaped}' | DISPLAY=:3 xclip -i -selection clipboard 2>/dev/null || printf %s '${escaped}' | DISPLAY=:3 xsel -i -b 2>/dev/null`];
    const run = await runGuest(guestCommand(bashArgs, { bindTmp: true }), TOOL_TIMEOUT_MS);
    return { content: [{ type: "text", text: run.out || `Clipboard set (${text.length} chars)` }], isError: run.code !== 0 };
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