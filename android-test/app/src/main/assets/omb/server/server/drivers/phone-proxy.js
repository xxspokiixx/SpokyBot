// First-party Android phone MCP server: physical USB devices only (no emulators, wireless or network ADB).
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { MAX_STEPS, MAX_WAIT_SECONDS, PHONE_STEP_TOOLS } from "../../shared/phone-steps.js";
const MAX_ADB_OUTPUT = 16 * 1024 * 1024;
const PHONE_BUSY_TEXT = "Another thread is using the phone. This call was not performed. Pause phone work until that thread finishes, then read the screen again before acting.";
const PACKAGE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
const COMPONENT = /^([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\/\S+$/;
const SAFE_TEXT = /^[A-Za-z0-9 _.,@-]+$/;
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
const KNOWN_PACKAGES = {
    skyscanner: "net.skyscanner.android.main",
    uber: "com.ubercab",
};
function executableName(platform = process.platform) {
    return platform === "win32" ? "adb.exe" : "adb";
}
export function resolveAdbPath(env = process.env, platform = process.platform) {
    const executable = executableName(platform);
    const home = homedir();
    const candidates = [
        env.OMB_ADB_PATH,
        env.OMB_RESOURCES_PATH && join(env.OMB_RESOURCES_PATH, "android-platform-tools", platform, executable),
        ...(env.PATH ?? "").split(delimiter).map((entry) => entry && join(entry, executable)),
        platform === "darwin" && join(home, "Library/Android/sdk/platform-tools/adb"),
        platform === "darwin" && "/opt/homebrew/bin/adb",
        platform === "darwin" && "/usr/local/bin/adb",
        platform === "linux" && join(home, "Android/Sdk/platform-tools/adb"),
    ].filter((candidate) => Boolean(candidate));
    for (const candidate of candidates) {
        try {
            accessSync(candidate, constants.X_OK);
            return candidate;
        }
        catch { }
    }
    return null;
}
async function runAdb(args, options = {}) {
    const adb = resolveAdbPath();
    if (!adb)
        throw new Error("Android platform tools are unavailable. Reopen SpokyBot or install adb.");
    return new Promise((resolve, reject) => {
        const child = spawn(adb, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        const stdout = [];
        const stderr = [];
        let size = 0;
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error("The Android device command timed out"));
        }, options.timeoutMs ?? 12_000);
        child.stdout.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_ADB_OUTPUT)
                child.kill();
            else
                stdout.push(chunk);
        });
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (size > MAX_ADB_OUTPUT)
                return reject(new Error("The Android device returned too much data"));
            if (code !== 0)
                return reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `adb exited ${code}`));
            resolve(Buffer.concat(stdout));
        });
    });
}
export function parseDevices(output) {
    const devices = [];
    for (const raw of output.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("List of devices attached") || line.startsWith("* daemon"))
            continue;
        const [serial, state, ...fields] = line.split(/\s+/);
        if (!serial || !state)
            continue;
        const connection = serial.startsWith("emulator-")
            ? "emulator"
            : serial.includes(":") || serial.startsWith("adb-")
                ? "network"
                : "usb";
        const properties = Object.fromEntries(fields.flatMap((field) => {
            const split = field.indexOf(":");
            return split > 0 ? [[field.slice(0, split), field.slice(split + 1)]] : [];
        }));
        devices.push({
            serial,
            state,
            connection,
            model: String(properties.model ?? properties.product ?? "Android device").replaceAll("_", " "),
        });
    }
    return devices;
}
async function usbDevices() {
    if (!resolveAdbPath())
        return [];
    return parseDevices((await runAdb(["devices", "-l"])).toString("utf8")).filter((device) => device.connection === "usb");
}
async function readySerial(requested) {
    const devices = await usbDevices();
    const serial = typeof requested === "string" && requested ? requested : process.env.PH_ANDROID_SERIAL;
    const candidates = serial ? devices.filter((device) => device.serial === serial) : devices;
    if (!candidates.length)
        throw new Error("No physical USB Android device is connected");
    if (candidates.length > 1 && !serial)
        throw new Error("Multiple USB Android devices are connected; pass serial");
    const device = candidates[0];
    if (device.state === "unauthorized")
        throw new Error("Unlock the phone and accept Allow USB debugging");
    if (device.state !== "device")
        throw new Error(`The Android device is ${device.state}`);
    return device.serial;
}
async function onDevice(serial, args, binary = false) {
    return runAdb(["-s", serial, ...args], { binary });
}
export const SWIPE_DIRECTIONS = new Set(["up", "down", "left", "right"]);
const SWIPE_DEFAULT_MS = 260;
const SWIPE_MIN_MS = 20, SWIPE_MAX_MS = 10_000;
const HOLD_MAX_MS = 10_000;
/** A whole number of milliseconds for a held tap, or null when the value is not one. Absent is no hold. */
export function holdMs(value) {
    if (value === undefined)
        return 0;
    const ms = Number(value);
    return Number.isInteger(ms) && ms >= 1 && ms <= HOLD_MAX_MS ? ms : null;
}
/**
 * The five numbers `input swipe` takes: start x, start y, end x, end y and duration. A chosen start (x, y) and distance
 * move the finger along the direction from there, so a list, a pane or a picker wheel scrolls by an exact amount; without
 * them the finger crosses half the screen through its centre, which is what a whole-page swipe wants.
 */
export function swipeLine(direction, width, height, args) {
    if (!SWIPE_DIRECTIONS.has(direction))
        throw new Error("direction must be up, down, left or right");
    const duration = args.duration_ms === undefined ? SWIPE_DEFAULT_MS : Number(args.duration_ms);
    if (!Number.isInteger(duration) || duration < SWIPE_MIN_MS || duration > SWIPE_MAX_MS) {
        throw new Error(`duration_ms must be a whole number from ${SWIPE_MIN_MS} to ${SWIPE_MAX_MS}`);
    }
    const chosen = args.x !== undefined || args.y !== undefined || args.distance !== undefined;
    if (!chosen) {
        const [x1, y1, x2, y2] = {
            up: [width / 2, height * 0.75, width / 2, height * 0.25],
            down: [width / 2, height * 0.25, width / 2, height * 0.75],
            left: [width * 0.75, height / 2, width * 0.25, height / 2],
            right: [width * 0.25, height / 2, width * 0.75, height / 2],
        }[direction];
        return [x1, y1, x2, y2, duration];
    }
    const startX = Number(args.x ?? width / 2), startY = Number(args.y ?? height / 2);
    const distance = args.distance === undefined ? Math.min(width, height) / 2 : Number(args.distance);
    if (!Number.isFinite(startX) || !Number.isFinite(startY) || startX < 0 || startY < 0 || startX > width || startY > height) {
        throw new Error(`x and y must fall on the screen: 0 to ${width} and 0 to ${height}`);
    }
    if (!Number.isFinite(distance) || distance <= 0 || distance > Math.hypot(width, height))
        throw new Error("distance must be a positive number of pixels on this screen");
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
    const endX = startX + dx * distance, endY = startY + dy * distance;
    // A finger that leaves the screen is refused here rather than by the phone: the answer then says what would have fit.
    if (endX < 0 || endY < 0 || endX > width || endY > height) {
        throw new Error(`a ${direction} swipe of ${Math.round(distance)} px from ${Math.round(startX)},${Math.round(startY)} ends off the screen; the screen is ${width} by ${height}`);
    }
    return [startX, startY, endX, endY, duration];
}
const isStepAction = (value) => value === "wait" || PHONE_STEP_TOOLS.includes(String(value));
function parseJson(value) {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
/** The batch's steps as the model wrote them; a refusal says which step, and that nothing was performed. */
export function parseSteps(raw) {
    const steps = parseJson(raw);
    if (!Array.isArray(steps) || !steps.length)
        throw new Error("steps must be a non-empty list of phone steps. No step was performed.");
    if (steps.length > MAX_STEPS)
        throw new Error(`a batch runs at most ${MAX_STEPS} steps. No step was performed.`);
    return steps.map((step, index) => {
        if (!step || typeof step !== "object" || Array.isArray(step))
            throw new Error(`step ${index + 1} is not an object. No step was performed.`);
        const action = step.action;
        if (!isStepAction(action))
            throw new Error(`step ${index + 1} has no known action. Use ${[...PHONE_STEP_TOOLS, "wait"].join(", ")}. No step was performed.`);
        if (action === "wait") {
            const seconds = Number(step.seconds ?? 1);
            if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_WAIT_SECONDS)
                throw new Error(`step ${index + 1}: seconds must be 0 to ${MAX_WAIT_SECONDS}. No step was performed.`);
        }
        return step;
    });
}
function normalize(value) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function parseLaunchablePackages(output) {
    const packages = [];
    for (const raw of output.split(/\r?\n/)) {
        const match = COMPONENT.exec(raw.trim());
        if (match && !packages.includes(match[1]))
            packages.push(match[1]);
    }
    return packages;
}
export function findPackages(name, packages) {
    if (PACKAGE.test(name) && packages.includes(name))
        return [name];
    const needle = normalize(name);
    const known = KNOWN_PACKAGES[needle];
    if (known && packages.includes(known))
        return [known];
    if (needle.length < 4)
        return [];
    const ranked = [
        (token) => token === needle,
        (token) => token.startsWith(needle),
        (token) => token.includes(needle),
    ];
    for (const matches of ranked) {
        const found = packages.filter((pkg) => pkg.split(".").some((token) => matches(normalize(token))));
        if (found.length)
            return found;
    }
    return [];
}
const PHONE_PERSON_TEXT = "A person has taken control of the phone, so this call was NOT performed. Do not act until they hand it back. " +
    "To wait, call read_screen: each phone call waits up to 45 seconds and returns as soon as they hand the phone back. " +
    "Meanwhile you may work on anything that does not need the phone.";
const PHONE_WAITED_TEXT = "The phone is free now, but this call had to wait for it, so it was NOT performed. " +
    "Call again: the next call goes through at once. If you meant to tap or type from an earlier read_screen, call read_screen again first: the screen may have changed while you waited.";
async function launchablePackages(serial) {
    const output = await onDevice(serial, [
        "shell", "cmd", "package", "query-activities", "--brief",
        "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
    ]);
    return parseLaunchablePackages(output.toString("utf8"));
}
function decodeXml(value) {
    return value
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
}
export function parseUiNodes(xml) {
    const nodes = [];
    for (const match of xml.matchAll(/<node\s+([^>]+?)\/?\s*>/g)) {
        const attributes = {};
        for (const attribute of match[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
            attributes[attribute[1]] = decodeXml(attribute[2]);
        }
        const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attributes.bounds ?? "");
        if (!bounds)
            continue;
        const text = attributes.text ?? "";
        const description = attributes["content-desc"] ?? "";
        if (!text && !description && !attributes["resource-id"])
            continue;
        nodes.push({
            text,
            description,
            id: attributes["resource-id"] ?? "",
            className: attributes.class ?? "",
            bounds: [Number(bounds[1]), Number(bounds[2]), Number(bounds[3]), Number(bounds[4])],
        });
    }
    return nodes;
}
async function readNodes(serial) {
    const streamed = (await onDevice(serial, ["shell", "uiautomator", "dump", "/dev/tty"])).toString("utf8");
    const streamedStart = streamed.indexOf("<?xml");
    if (streamedStart >= 0)
        return parseUiNodes(streamed.slice(streamedStart));
    const remotePath = "/data/local/tmp/openmaus-window.xml";
    await onDevice(serial, ["shell", "uiautomator", "dump", remotePath]);
    const saved = (await onDevice(serial, ["shell", "cat", remotePath])).toString("utf8");
    void onDevice(serial, ["shell", "rm", "-f", remotePath]).catch(() => undefined);
    const savedStart = saved.indexOf("<?xml");
    return parseUiNodes(savedStart >= 0 ? saved.slice(savedStart) : saved);
}
function nodeLines(nodes) {
    return nodes.slice(0, 250).map((node, index) => {
        const label = [node.text, node.description].filter(Boolean).join(" · ");
        return `${index}: ${JSON.stringify(label || node.id)} bounds=${node.bounds.join(",")} class=${node.className}`;
    }).join("\n") || "No accessible Android UI text is visible.";
}
const BATCH_HINT = "To do several steps, or to act and then read the screen, in one call, use batch.";
const takesBatchHint = (name) => name !== "read_screen" && PHONE_STEP_TOOLS.includes(name);
const SINGLE_TOOLS = [
    { name: "status", description: "Check physical USB Android devices and USB-debugging authorization before any Android phone task.", inputSchema: { type: "object", properties: {} } },
    { name: "read_screen", description: "Read visible text, accessibility labels, resource ids, and pixel bounds from the connected Android screen. Use it before choosing what to act on. To act and see the result in one call, put the action and read_screen in one batch.", inputSchema: { type: "object", properties: { serial: { type: "string" } } } },
    { name: "screenshot", description: "Capture the connected Android screen when accessibility text is insufficient. Returns a PNG image.", inputSchema: { type: "object", properties: { serial: { type: "string" } } } },
    { name: "list_apps", description: "List installed launchable Android package names, optionally filtered by a human app name. Prefer open_app first.", inputSchema: { type: "object", properties: { query: { type: "string" }, serial: { type: "string" } } } },
    { name: "open_app", description: "Open an installed Android app directly by its English name, such as Uber or Skyscanner, or by its package name. Do not scan the app drawer first.", inputSchema: { type: "object", properties: { name: { type: "string" }, serial: { type: "string" } }, required: ["name"] } },
    { name: "tap_text", description: "Tap visible Android text or an accessibility label.", inputSchema: { type: "object", properties: { text: { type: "string" }, exact: { type: "boolean" }, index: { type: "integer", minimum: 0 }, serial: { type: "string" } }, required: ["text"] } },
    { name: "tap", description: "Tap Android screen pixel coordinates obtained from read_screen or screenshot. Add duration_ms to hold the tap; about 1000 is a long press.", inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, duration_ms: { type: "integer" }, serial: { type: "string" } }, required: ["x", "y"] } },
    { name: "swipe", description: "Swipe the Android screen in a direction. By default the finger moves half the screen through the centre in 260 ms. To scroll a list, a pane or a picker wheel by a chosen amount, give x and y (where the finger starts), distance (pixels it moves) and duration_ms (longer is slower).", inputSchema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] }, x: { type: "number" }, y: { type: "number" }, distance: { type: "number" }, duration_ms: { type: "integer" }, serial: { type: "string" } }, required: ["direction"] } },
    { name: "type_text", description: "Type basic ASCII text into the focused Android field. Never enter passwords or payment details. A one-time code only for a sign-in the person asked for, into the app it was sent for.", inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 256 }, serial: { type: "string" } }, required: ["text"] } },
    { name: "press", description: "Press an Android navigation or keyboard key. wakeup turns the screen on and sleep turns it off.", inputSchema: { type: "object", properties: { key: { type: "string", enum: Object.keys(KEYCODES) }, serial: { type: "string" } }, required: ["key"] } },
];
const STEP_ACTIONS = [...PHONE_STEP_TOOLS, "wait"];
const STEP_PROPERTIES = {
    action: { type: "string", enum: STEP_ACTIONS },
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
    seconds: { type: "number" },
};
export const TOOLS = [
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
const textResult = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
// The harness reserves the phone per turn from the first real tool call. Retained MCP processes can
// outlive their turn, so every call revalidates the claim.
export function createPhoneClaim(env = process.env, fetchImpl = fetch) {
    const url = env.OMB_HARNESS_URL?.trim();
    const token = env.OMB_PHONE_TOKEN?.trim();
    if (!url || !token) {
        return async () => ({ ok: true });
    }
    return async () => {
        try {
            const response = await fetchImpl(new URL("/api/internal/phone/claim", url), {
                method: "POST",
                redirect: "error",
                headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                body: "{}",
                signal: AbortSignal.timeout(10_000),
            });
            if (response.ok) {
                // `waited`: the phone was held for a moment and this call was let through after it. The call itself still runs.
                const waited = await response.json().catch(() => null);
                return { ok: true, ...(waited?.waited === true ? { waited: true } : {}) };
            }
            if (response.status === 409)
                return { ok: false, message: PHONE_BUSY_TEXT };
            // A person is holding the phone: not an error, and not the AI's, so the text says what to do about it.
            if (response.status === 423)
                return { ok: false, message: PHONE_PERSON_TEXT };
            if (response.status === 401 || response.status === 403) {
                return { ok: false, message: "This turn no longer has phone access. Start a new turn to use the phone." };
            }
            return { ok: false, message: "SpokyBot could not reserve the phone for this call. This call was not performed; try again, or start a new turn if it keeps failing." };
        }
        catch {
            return { ok: false, message: "SpokyBot could not be reached to reserve the phone. This call was not performed; try again." };
        }
    };
}
async function callTool(name, args) {
    if (name === "status") {
        const adb = resolveAdbPath();
        const devices = adb ? await usbDevices() : [];
        return textResult(JSON.stringify({ available: Boolean(adb), devices }, null, 2));
    }
    const serial = await readySerial(args.serial);
    if (name === "read_screen")
        return textResult(nodeLines(await readNodes(serial)));
    if (name === "screenshot") {
        const png = await onDevice(serial, ["exec-out", "screencap", "-p"], true);
        if (!png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
            throw new Error("Android returned an invalid screenshot");
        return { content: [{ type: "text", text: `Android screenshot from ${serial}` }, { type: "image", data: png.toString("base64"), mimeType: "image/png" }] };
    }
    if (name === "list_apps") {
        const packages = await launchablePackages(serial);
        const query = typeof args.query === "string" ? args.query : "";
        return textResult((query ? findPackages(query, packages) : packages).join("\n") || "No matching launchable app found");
    }
    if (name === "open_app") {
        const appName = String(args.name ?? "").trim();
        if (!appName)
            throw new Error("name is required");
        const matches = findPackages(appName, await launchablePackages(serial));
        if (matches.length !== 1)
            throw new Error(matches.length ? `App name is ambiguous: ${matches.join(", ")}` : `No installed launchable app matches ${JSON.stringify(appName)}`);
        await onDevice(serial, ["shell", "monkey", "-p", matches[0], "-c", "android.intent.category.LAUNCHER", "1"]);
        return textResult(`Opened ${appName} (${matches[0]})`);
    }
    if (name === "tap_text") {
        const query = String(args.text ?? "").trim().toLowerCase();
        if (!query)
            throw new Error("text is required");
        const exact = args.exact === true;
        const hits = (await readNodes(serial)).filter((node) => {
            const labels = [node.text, node.description].filter(Boolean).map((value) => value.toLowerCase());
            return labels.some((label) => exact ? label === query : label.includes(query));
        });
        const index = Number.isInteger(args.index) ? Number(args.index) : 0;
        const hit = hits[index];
        if (!hit)
            throw new Error(`No visible Android text matches ${JSON.stringify(args.text)}`);
        const [x1, y1, x2, y2] = hit.bounds;
        await onDevice(serial, ["shell", "input", "tap", String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))]);
        return textResult(`Tapped ${JSON.stringify(hit.text || hit.description)}`);
    }
    if (name === "tap") {
        const x = Number(args.x);
        const y = Number(args.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 10000 || y > 10000)
            throw new Error("Invalid Android coordinates");
        const held = holdMs(args.duration_ms);
        if (held === null)
            throw new Error("duration_ms must be a whole number from 1 to 10000");
        // A held tap goes through `input swipe` with the finger still: `input tap` has no duration.
        if (held)
            await onDevice(serial, ["shell", "input", "swipe", String(Math.round(x)), String(Math.round(y)), String(Math.round(x)), String(Math.round(y)), String(held)]);
        else
            await onDevice(serial, ["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
        return textResult(held ? `Held ${Math.round(x)},${Math.round(y)} for ${held} ms` : `Tapped ${Math.round(x)},${Math.round(y)}`);
    }
    if (name === "swipe") {
        const direction = String(args.direction ?? "");
        if (!SWIPE_DIRECTIONS.has(direction))
            throw new Error("direction must be up, down, left or right");
        const size = (await onDevice(serial, ["shell", "wm", "size"])).toString("utf8");
        const match = /(\d+)x(\d+)/.exec(size);
        if (!match)
            throw new Error("Could not read Android screen size");
        const width = Number(match[1]);
        const height = Number(match[2]);
        const point = swipeLine(direction, width, height, args);
        await onDevice(serial, ["shell", "input", "swipe", ...point.map((value) => String(Math.round(value)))]);
        return textResult(point[4] === 260 ? `Swiped ${direction}` : `Swiped ${direction} over ${Math.round(point[4])} ms`);
    }
    if (name === "type_text") {
        const value = String(args.text ?? "");
        if (!value || value.length > 256 || !SAFE_TEXT.test(value))
            throw new Error("Android text supports only basic ASCII text up to 256 characters");
        await onDevice(serial, ["shell", "input", "text", value.replaceAll(" ", "%s")]);
        return textResult("Typed text into the focused Android field");
    }
    if (name === "press") {
        const key = String(args.key ?? "").toLowerCase();
        if (!KEYCODES[key])
            throw new Error("Unsupported Android key");
        await onDevice(serial, ["shell", "input", "keyevent", KEYCODES[key]]);
        return textResult(`Pressed ${key}`);
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
            const fields = { ...step, serial };
            try {
                const result = await callTool(action, fields);
                done.push(stepLine(action, fields, result));
                if (action === "read_screen")
                    screen = result;
            }
            catch (error) {
                const why = error instanceof Error ? error.message : String(error);
                throw new Error(`Step ${index + 1} (${action}) failed: ${why} Steps done before it: ${done.length ? done.join("; ") : "none"}. Read the screen before acting again.`);
            }
        }
        // Only the last read_screen comes back as an image; the steps before it are one line each.
        return screen ?? textResult(done.join("\n"));
    }
    throw new Error(`Unknown phone tool: ${name}`);
}
/** One batch step's line: what it did, from the tool's own answer. */
function stepLine(action, _fields, result) {
    const text = result.content.map((part) => (part.type === "text" ? part.text : "[image]")).join(" ");
    if (action === "read_screen")
        return `read the screen (${text.split("\n").filter(Boolean).length} elements)`;
    return text.replace(/^Android screenshot .*$/, "took a screenshot");
}
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
async function handle(message, ensureClaim) {
    const id = message.id;
    const method = message.method;
    const params = (message.params ?? {});
    if (method === "initialize")
        return ok(id, { protocolVersion: String(params.protocolVersion ?? "2024-11-05"), capabilities: { tools: {} }, serverInfo: { name: "openmausbot-phone", version: "1" } });
    if (method === "notifications/initialized" || method === "notifications/cancelled")
        return;
    if (method === "ping")
        return ok(id, {});
    if (method === "tools/list")
        return ok(id, { tools: TOOLS });
    if (method === "tools/call") {
        const name = String(params.name ?? "");
        if (!TOOLS.some((tool) => tool.name === name))
            return rpcError(id, -32602, `Unknown tool: ${name}`);
        const claim = await ensureClaim();
        if (!claim.ok)
            return ok(id, textResult(claim.message, true));
        // A call let through after a wait still does not run: what the model planned may no longer match the screen.
        if (claim.waited)
            return ok(id, textResult(PHONE_WAITED_TEXT, true));
        try {
            return ok(id, await callTool(name, (params.arguments ?? {})));
        }
        catch (error) {
            return ok(id, textResult(error instanceof Error ? error.message : String(error), true));
        }
    }
    if (id !== undefined)
        rpcError(id, -32601, `Method not found: ${String(method)}`);
}
if (process.argv[1] && existsSync(process.argv[1]) && /phone-proxy\.(?:ts|js)$/.test(process.argv[1])) {
    const ensureClaim = createPhoneClaim();
    const lines = createInterface({ input: process.stdin, terminal: false });
    lines.on("line", (line) => {
        try {
            const message = JSON.parse(line);
            void handle(message, ensureClaim).catch((error) => rpcError(message.id, -32603, error instanceof Error ? error.message : String(error)));
        }
        catch { }
    });
}
