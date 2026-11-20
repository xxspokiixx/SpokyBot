#!/usr/bin/env node
// The phone build's device-apps MCP: the same tool surface as the desktop's adb
// phone proxy (server/drivers/phone-proxy.ts), driven not by adb — there is none
// on-device — but by the app's granted AccessibilityService over a private UNIX
// socket. Tool names, schemas and result strings mirror the desktop proxy so
// models trained on OMB's phone-harness skill work unchanged.
import { connect } from "node:net";

const PORT = Number(process.env.OMB_ANDROID_APPS_PORT ?? 8798);
const CLAIM_URL = process.env.OMB_HARNESS_URL?.trim() ?? "";
const CLAIM_TOKEN = process.env.OMB_PHONE_TOKEN?.trim() ?? "";
const CLAIM_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 20_000;

const PHONE_BUSY_TEXT = "Another thread is using the phone. This call was not performed. Pause phone work until that thread finishes, then read the screen again before acting.";

const KEYCODES = {
  back: "KEYCODE_BACK",
  delete: "KEYCODE_DEL",
  down: "KEYCODE_DPAD_DOWN",
  enter: "KEYCODE_ENTER",
  escape: "KEYCODE_BACK",
  home: "KEYCODE_HOME",
  left: "KEYCODE_DPAD_LEFT",
  recent: "KEYCODE_APP_SWITCH",
  return: "KEYCODE_ENTER",
  right: "KEYCODE_DPAD_RIGHT",
  sleep: "KEYCODE_SLEEP",
  space: "KEYCODE_SPACE",
  tab: "KEYCODE_TAB",
  up: "KEYCODE_DPAD_UP",
  wakeup: "KEYCODE_WAKEUP",
};

const MAX_STEPS = 12;
const MAX_WAIT_SECONDS = 10;
const BATCH_HINT = "To do several steps, or to act and then read the screen, in one call, use batch.";
const STEP_TOOLS = ["open_app", "tap_text", "tap", "swipe", "type_text", "press", "read_screen"];
const takesBatchHint = (name) => name !== "read_screen" && STEP_TOOLS.includes(name);

const SINGLE_TOOLS = [
  { name: "status", description: "Check the on-device app control service before any phone task. If it is not granted, tell the person to enable 'SpokyBot app control' in Accessibility settings, then try the web version of the task in the bot browser.", inputSchema: { type: "object", properties: {} } },
  { name: "read_screen", description: "Read visible text, accessibility labels, resource ids, and pixel bounds from the connected Android screen. Use it before choosing what to act on. To act and see the result in one call, put the action and read_screen in one batch.", inputSchema: { type: "object", properties: { serial: { type: "string" } } } },
  { name: "screenshot", description: "Capture the connected Android screen when accessibility text is insufficient. Returns a PNG image.", inputSchema: { type: "object", properties: { serial: { type: "string" } } } },
  { name: "list_apps", description: "List installed launchable Android package names, optionally filtered by a human app name. Prefer open_app first.", inputSchema: { type: "object", properties: { query: { type: "string" }, serial: { type: "string" } } } },
  { name: "open_app", description: "Open an installed Android app directly by its human name, such as Uber or Skyscanner. Do not scan the app drawer first. If this is unavailable or fails, fall back to the bot browser's web version of the service, and only if there is no web version use the phone control tools (tap/type/press) after telling the person the phone will be controlled for a moment.", inputSchema: { type: "object", properties: { name: { type: "string" }, serial: { type: "string" } }, required: ["name"] } },
  { name: "tap_text", description: "Tap visible Android text or an accessibility label.", inputSchema: { type: "object", properties: { text: { type: "string" }, exact: { type: "boolean" }, index: { type: "integer", minimum: 0 }, serial: { type: "string" } }, required: ["text"] } },
  { name: "tap", description: "Tap Android screen pixel coordinates obtained from read_screen or screenshot. Add duration_ms to hold the tap; about 1000 is a long press.", inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, duration_ms: { type: "integer" }, serial: { type: "string" } }, required: ["x", "y"] } },
  { name: "swipe", description: "Swipe the Android screen in a direction. By default the finger moves 40% of the screen through its centre in 220 ms. To scroll a list, a pane or a picker wheel by a chosen amount, give x and y (where the finger starts), distance (pixels it moves) and duration_ms (longer is slower).", inputSchema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] }, x: { type: "number" }, y: { type: "number" }, distance: { type: "number" }, duration_ms: { type: "integer" }, serial: { type: "string" } }, required: ["direction"] } },
  { name: "type_text", description: "Type text into the focused Android field. Set clear to true to empty the field first. Never enter passwords or payment details. A one-time code only for a sign-in the person asked for, into the app it was sent for.", inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 256 }, clear: { type: "boolean" }, serial: { type: "string" } }, required: ["text"] } },
  { name: "press", description: "Press an Android navigation or keyboard key. wakeup turns the screen on and sleep turns it off.", inputSchema: { type: "object", properties: { key: { type: "string", enum: Object.keys(KEYCODES) }, serial: { type: "string" } }, required: ["key"] } },
];

const STEP_PROPERTIES = {
  action: { type: "string", enum: [...STEP_TOOLS, "wait"] },
  text: { type: "string" },
  exact: { type: "boolean" },
  index: { type: "integer", minimum: 0 },
  name: { type: "string" },
  x: { type: "number" },
  y: { type: "number" },
  distance: { type: "number" },
  duration_ms: { type: "integer" },
  direction: { type: "string", enum: ["up", "down", "left", "right"] },
  key: { type: "string", enum: Object.keys(KEYCODES) },
  clear: { type: "boolean" },
  seconds: { type: "number" },
};

const TOOLS = [
  ...SINGLE_TOOLS.map((tool) => (takesBatchHint(tool.name) ? { ...tool, description: `${tool.description} ${BATCH_HINT}` } : tool)),
  {
    name: "batch",
    description: `Run up to ${MAX_STEPS} phone steps in order in one call. A step is one of open_app, tap_text, tap, swipe, type_text, press, read_screen or wait, with that tool's fields: {action, ...fields}. Add read_screen as the last step to see the result; the batch returns the screen only at a read_screen step. A wait step (0 to ${MAX_WAIT_SECONDS} s) gives content time to load. It stops at the first failing step. End a batch where the next screen is uncertain, such as after a step that may open a dialog, and read it before acting further. Example: {"steps":[{"action":"tap_text","text":"Search"},{"action":"type_text","text":"iPad mini"},{"action":"press","key":"enter"},{"action":"wait","seconds":3},{"action":"read_screen"}]}`,
    inputSchema: {
      type: "object",
      properties: {
        steps: { type: "array", maxItems: MAX_STEPS, items: { type: "object", properties: STEP_PROPERTIES, required: ["action"] } },
        serial: { type: "string" },
      },
      required: ["steps"],
    },
  },
];

const GRANT_STEPS = "On this device: Settings → Accessibility → Installed apps (or Downloaded apps) → \"SpokyBot app control\" → enable. Then call status again.";

function askService(payload) {
  return new Promise((resolve) => {
    const client = connect(PORT, "127.0.0.1", () => {
      client.write(JSON.stringify(payload) + "\n");
    });
    let buffer = "";
    const finish = (answer) => {
      clearTimeout(timer);
      client.destroy();
      resolve(answer);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "The app control service did not answer in time" }), CALL_TIMEOUT_MS);
    client.setEncoding("utf8");
    client.on("data", (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index >= 0) {
        try {
          finish(JSON.parse(buffer.slice(0, index)));
        } catch {
          finish({ ok: false, error: "The app control service sent a malformed answer" });
        }
      }
    });
    client.on("error", () => finish({ ok: false, error: `The app control service is not reachable on 127.0.0.1:${PORT}. ${GRANT_STEPS}` }));
  });
}

// The harness reserves the phone per turn; every call revalidates the claim.
async function claimPhone() {
  if (!CLAIM_URL || !CLAIM_TOKEN) return { ok: true };
  try {
    const response = await fetch(new URL("/api/internal/phone/claim", CLAIM_URL), {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${CLAIM_TOKEN}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    if (response.status === 409) return { ok: false, message: PHONE_BUSY_TEXT };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "This turn no longer has phone access. Start a new turn to use the phone." };
    }
    return { ok: false, message: "OpenMausBot could not reserve the phone for this call. This call was not performed; try again, or start a new turn if it keeps failing." };
  } catch {
    return { ok: false, message: "OpenMausBot could not be reached to reserve the phone. This call was not performed; try again." };
  }
}

function nodeLines(nodes) {
  return nodes.slice(0, 250).map((node, index) => {
    const label = [node.text, node.description].filter(Boolean).join(" • ");
    return `${index}: ${JSON.stringify(label || node.id)} bounds=${node.bounds.join(",")} class=${node.className}`;
  }).join("\n") || "No accessible Android UI text is visible.";
}

const textResult = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

/** The batch's steps as the model wrote them; a refusal says which step, and that nothing was performed. */
function parseSteps(raw) {
  let steps = raw;
  if (typeof raw === "string") {
    try {
      steps = JSON.parse(raw);
    } catch {
      throw new Error("steps must be a list of phone steps. No step was performed.");
    }
  }
  if (!Array.isArray(steps) || !steps.length) throw new Error("steps must be a non-empty list of phone steps. No step was performed.");
  if (steps.length > MAX_STEPS) throw new Error(`a batch runs at most ${MAX_STEPS} steps. No step was performed.`);
  return steps.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`step ${index + 1} is not an object. No step was performed.`);
    if (step.action !== "wait" && !STEP_TOOLS.includes(step.action)) {
      throw new Error(`step ${index + 1} has no known action. Use ${[...STEP_TOOLS, "wait"].join(", ")}. No step was performed.`);
    }
    if (step.action === "wait") {
      const seconds = Number(step.seconds ?? 1);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_WAIT_SECONDS) throw new Error(`step ${index + 1}: seconds must be 0 to ${MAX_WAIT_SECONDS}. No step was performed.`);
    }
    return step;
  });
}

async function callTool(name, args) {
  if (name === "status") {
    const probe = await askService({ action: "status" });
    return textResult(
      probe.ok
        ? JSON.stringify({ available: true, service: "granted", device: "this device" }, null, 2)
        : JSON.stringify({ available: false, service: "not granted", reason: probe.error, howToGrant: GRANT_STEPS }, null, 2),
    );
  }
  if (name === "screenshot") {
    return textResult("Screenshots are not available for the on-device service; read_screen returns the full accessibility tree instead.", true);
  }
  if (name === "batch") {
    const steps = parseSteps(args.steps);
    const done = [];
    let screen = null;
    for (const [index, step] of steps.entries()) {
      const action = step.action;
      if (action === "wait") {
        const seconds = Number(step.seconds ?? 1);
        await new Promise((done) => setTimeout(done, seconds * 1_000));
        done.push(`waited ${seconds} s`);
        continue;
      }
      try {
        // `...step` first: it carries `action`, which must not overwrite the service's own action name.
        const result = await callTool(action, { ...step, action: undefined, serial: args.serial });
        done.push(stepLine(action, result));
        if (action === "read_screen") screen = result;
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(`Step ${index + 1} (${action}) failed: ${why} Steps done before it: ${done.length ? done.join("; ") : "none"}. Read the screen before acting again.`);
      }
    }
    return screen ?? textResult(done.join("\n"));
  }
  const claim = await claimPhone();
  if (!claim.ok) return textResult(claim.message, true);
  const action = ACTION_FOR[name];
  if (!action) throw new Error(`Unknown phone tool: ${name}`);
  // The tool's own fields, then the service's action last: a step's `action` must never replace it.
  const { serial: _serial, ...fields } = args ?? {};
  const answer = await askService({ ...fields, action });
  if (!answer.ok) return textResult(String(answer.error ?? "the call failed"), true);
  if (name === "read_screen") return textResult(nodeLines(answer.nodes ?? []));
  if (name === "list_apps") return textResult((answer.apps ?? []).join("\n") || "No matching launchable app found");
  if (name === "open_app") return textResult(`Opened ${answer.opened} (${answer.package})`);
  if (name === "tap_text") return textResult(`Tapped ${JSON.stringify(answer.tapped)}`);
  if (name === "tap") return textResult(`Tapped ${answer.tapped}`);
  if (name === "swipe") return textResult(`Swiped ${answer.swiped}`);
  if (name === "type_text") return textResult(`Typed ${answer.typed} character(s)${answer.cleared ? " into the emptied field" : ""}`);
  if (name === "press") return textResult(`Pressed ${answer.pressed}`);
  return textResult(JSON.stringify(answer));
}

/** One batch step's line: what it did, from the tool's own answer. */
function stepLine(action, result) {
  const text = result.content.map((part) => (part.type === "text" ? part.text : "[image]")).join(" ");
  if (action === "read_screen") return `read the screen (${text.split("\n").filter(Boolean).length} elements)`;
  return text;
}

const ACTION_FOR = {
  read_screen: "screen",
  list_apps: "apps",
  open_app: "open",
  tap_text: "tap_text",
  tap: "tap",
  swipe: "swipe",
  type_text: "type",
  press: "press",
};

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
// A caller may close stdin right after its last call, and its last message may arrive without a closing newline: read
// what is left, then wait for the replies it is still owed before leaving.
process.stdin.on("end", () => {
  if (buffer.trim()) {
    handle(buffer.trim());
    buffer = "";
  }
  const wait = () => (pending ? setTimeout(wait, 50) : process.exit(0));
  wait();
});

/** Calls in flight: a closed stdin must not cut a reply the caller is still waiting for. */
let pending = 0;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

/**
 * One tools/call, with its claim; the reply is sent here so the end of stdin can wait for it. A claim refused (another
 * thread holds the phone) is an answer, not a failure: it says so and nothing was performed.
 */
async function runTool(message) {
  const id = message.id;
  pending++;
  try {
    const result = await callTool(String(message.params?.name ?? ""), message.params?.arguments ?? {});
    send({ jsonrpc: "2.0", id, result });
  } catch (error) {
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true } });
  } finally {
    pending--;
  }
}

function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const { method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0", id: message.id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openmausbot-android-device-phone", version: "1.0.0" },
      },
    });
    return;
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id: message.id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    void runTool(message);
    return;
  }
  if (method === "resources/list" || method === "prompts/list") {
    return send({ jsonrpc: "2.0", id: message.id, result: { resources: [], prompts: [] } });
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${method}` } });
}

process.on("uncaughtException", (error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
});
