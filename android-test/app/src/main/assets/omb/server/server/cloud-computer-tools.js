import { isolatedRemoteCommand, runCommand, screenshotBoat } from "./boat.js";
import { isRedditAddress, REDDIT_REFUSAL } from "./browser/egress/reddit.js";
import { controlRefusal } from "./control-client.js";
import { HARNESS_CALL_BUDGET_MS } from "./harness-budget.js";
import { compileToolSchema } from "./mcp-schema-validator.js";
const coordinate = { type: "integer", minimum: 0, maximum: 32767 };
const tool = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } });
export const CLOUD_COMPUTER_TOOLS = [
    tool("screenshot", "See the assigned cloud desktop at native pixel resolution."),
    tool("get_screen_size", "Get the cloud desktop width and height."),
    tool("click", "Click a point on the cloud desktop.", { x: coordinate, y: coordinate, button: { type: "string", enum: ["left", "middle", "right"] }, count: { type: "integer", minimum: 1, maximum: 3 } }, ["x", "y"]),
    tool("move", "Move the cloud mouse pointer.", { x: coordinate, y: coordinate }, ["x", "y"]),
    tool("drag", "Drag on the cloud desktop.", { x: coordinate, y: coordinate, to_x: coordinate, to_y: coordinate }, ["x", "y", "to_x", "to_y"]),
    tool("type_text", "Type Unicode text into the focused cloud application.", { text: { type: "string", maxLength: 4000 } }, ["text"]),
    tool("key_press", "Press an X11 key or shortcut.", { key: { type: "string", pattern: "^[A-Za-z0-9_+]+$", minLength: 1, maxLength: 100 } }, ["key"]),
    tool("scroll", "Scroll at a point on the cloud desktop.", { x: coordinate, y: coordinate, direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "integer", minimum: 1, maximum: 30 } }, ["x", "y", "direction"]),
    tool("open_url", "Request opening an HTTP or HTTPS URL in the cloud desktop browser; inspect the screen to confirm it loaded.", { url: { type: "string", pattern: "^https?://", maxLength: 2000 } }, ["url"]),
    tool("exec", "Run a shell command on the assigned cloud computer.", { command: { type: "string", minLength: 1, maxLength: 4000 } }, ["command"]),
];
/** A call the gate let through while no Boat had landed for the turn. */
export const CLOUD_COMPUTER_NOT_READY = "The cloud computer is not ready. This call was not performed. Take a fresh screenshot in a moment.";
export const CLOUD_COMPUTER_LATE = "The cloud computer did not answer in time. This call may still have run; take a fresh screenshot before repeating it.";
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
const buttons = { left: 1, middle: 2, right: 3 };
const scrollButtons = { up: 4, down: 5, left: 6, right: 7 };
let validators;
/** x and y reach the remote shell unquoted, so only the advertised integer schema stands between a model's arguments and a command line.
 * A cloud computer browses from a data centre, so it never opens Reddit. */
export function cloudComputerCallProblem(name, args) {
    validators ??= new Map(CLOUD_COMPUTER_TOOLS.map(entry => [entry.name, compileToolSchema(entry.inputSchema)]));
    const validate = typeof name === "string" ? validators.get(name) : undefined;
    if (!validate)
        return "Unknown cloud computer tool. Use one of the advertised computer tools.";
    if (!args || typeof args !== "object" || Array.isArray(args) || !validate(args)) {
        return "Tool arguments do not match the advertised input schema; use its required fields and types.";
    }
    if (name === "open_url" && isRedditAddress(String(args.url)))
        return REDDIT_REFUSAL;
    return null;
}
/** The caller has already checked the arguments and the person's control. */
export async function runCloudComputerTool(cfg, boxId, name, args, signal) {
    const problem = cloudComputerCallProblem(name, args);
    if (problem)
        return { isError: true, content: [{ type: "text", text: problem }] };
    signal.throwIfAborted();
    if (name === "screenshot") {
        const shot = await screenshotBoat(cfg, "", boxId, { signal, nativeSize: true });
        signal.throwIfAborted();
        return { content: [{ type: "image", mimeType: "image/jpeg", data: shot.png }] };
    }
    const a = args;
    const mouse = `xdotool mousemove --sync ${a.x} ${a.y}`;
    let command;
    switch (name) {
        case "get_screen_size":
            command = "xdotool getdisplaygeometry";
            break;
        case "click":
            command = `${mouse} click --repeat ${a.count ?? 1} --delay 100 ${buttons[String(a.button ?? "left")]}`;
            break;
        case "move":
            command = mouse;
            break;
        case "drag":
            command = `${mouse} mousedown 1 mousemove --sync ${a.to_x} ${a.to_y} mouseup 1`;
            break;
        case "type_text":
            command = `printf %s ${quote(Buffer.from(String(a.text)).toString("base64"))} | base64 -d | xclip -selection clipboard && xdotool key --clearmodifiers ctrl+v`;
            break;
        case "key_press":
            command = `xdotool key --clearmodifiers ${quote(String(a.key))}`;
            break;
        case "scroll":
            command = `${mouse} click --repeat ${a.amount ?? 3} --delay 80 ${scrollButtons[String(a.direction)]}`;
            break;
        case "open_url":
            command = `nohup xdg-open ${quote(String(a.url))} >/dev/null 2>&1 </dev/null &`;
            break;
        case "exec":
            command = String(a.command);
            break;
        default: return { isError: true, content: [{ type: "text", text: "Unknown cloud computer tool." }] };
    }
    const result = await runCommand(cfg, boxId, isolatedRemoteCommand(command), { signal });
    signal.throwIfAborted();
    if (name === "open_url" && result.ok)
        return { content: [{ type: "text", text: "Browser launch requested. Page loading is not confirmed; inspect the screen before continuing." }] };
    return { isError: !result.ok, content: [{ type: "text", text: JSON.stringify(result) }] };
}
/** The order is the safety argument: arguments, then the control gate (which may create or wake the Boat), then the Boat
 * read; the turn's capability must be live before and after the Boat acts. Listing touches no Boat. */
export async function cloudComputerRpc(request, deps) {
    const deadline = Date.now() + (deps.budgetMs ?? HARNESS_CALL_BUDGET_MS);
    if (request?.method === "tools/list") {
        deps.assertActive();
        return { tools: CLOUD_COMPUTER_TOOLS };
    }
    if (request?.method !== "tools/call")
        throw Object.assign(new Error("unsupported computer method"), { status: 400 });
    const params = (request.params && typeof request.params === "object" ? request.params : {});
    const args = params.arguments ?? {};
    const problem = cloudComputerCallProblem(params.name, args);
    if (problem)
        return { isError: true, content: [{ type: "text", text: problem }] };
    const control = await deps.gate();
    deps.assertActive();
    if (control.held)
        return { isError: true, content: [{ type: "text", text: controlRefusal(control) }] };
    const boxId = deps.boxId();
    if (!boxId)
        return { isError: true, content: [{ type: "text", text: CLOUD_COMPUTER_NOT_READY }] };
    const late = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    let result;
    try {
        result = await runCloudComputerTool(deps.cfg, boxId, params.name, args, AbortSignal.any([deps.signal, late]));
    }
    catch (error) {
        if (!late.aborted || deps.signal.aborted)
            throw error;
        return { isError: true, content: [{ type: "text", text: CLOUD_COMPUTER_LATE }] };
    }
    deps.assertActive();
    return result;
}
