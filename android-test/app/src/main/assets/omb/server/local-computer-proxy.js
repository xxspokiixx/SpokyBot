import { createRequire as __ombCreateRequire } from "node:module";
const require = __ombCreateRequire(import.meta.url);

// server/mcp-bridge.ts
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

// server/control-client.ts
var CONTROL_WAIT_MS = 45e3;
var CONTROL_ACT_WITHIN_MS = 5e3;
var READ_TIMEOUT_MS = CONTROL_WAIT_MS + 1e4;
var WAIT_WORDS = `${CONTROL_WAIT_MS / 1e3} seconds`;
var CONTROL_REFUSAL_PLAIN = `A person has taken control of this computer, so this call was NOT performed. Do not act until they hand it back \u2014 the screen is changing under their hands. To wait for them, take a screenshot: each computer call waits up to ${WAIT_WORDS} and returns as soon as they hand control back. Meanwhile you may work on anything that does not need this computer.`;
var CONTROL_WAITED = "This computer is free now, but this call had to wait for it, so it was NOT performed. Call again: the next call goes through at once. If you meant to click or type from an earlier screenshot, take a fresh one first \u2014 the screen may have changed while you waited.";
var CONTROL_BUSY = `Another thread is using this computer. This call was not performed. This turn gets the computer as soon as it is free: to keep waiting, take a screenshot (each computer call waits up to ${WAIT_WORDS}) instead of ending your turn.`;
var CONTROL_UNCONFIRMED = "SpokyBot could not confirm that this computer is free, so this call was NOT performed and nothing happened on the screen. Retry in a few seconds.";
var DISENGAGED = { held: false, helpOpen: false };
var UNCONFIRMED = { held: true, helpOpen: false, blockedReason: CONTROL_UNCONFIRMED };
function controlRefusal(state) {
  return state.blockedReason ?? (state.reason === "person" ? CONTROL_REFUSAL_PLAIN : CONTROL_UNCONFIRMED);
}
function createControlClient(options) {
  const url2 = options?.url ?? process.env.OMB_CONTROL_URL ?? "";
  const token2 = options?.token ?? process.env.OMB_CONTROL_TOKEN ?? "";
  const cacheMs = options?.cacheMs ?? 750;
  const timeoutMs = options?.timeoutMs ?? READ_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const configured = Boolean(url2 && token2);
  const headers = { authorization: `Bearer ${token2}`, "content-type": "application/json" };
  let cachedAt = 0;
  let cached2 = DISENGAGED;
  async function read() {
    try {
      const res = await fetchImpl(url2, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return UNCONFIRMED;
      const body = await res.json().catch(() => null);
      if (typeof body?.held !== "boolean" || typeof body?.helpOpen !== "boolean") return UNCONFIRMED;
      return {
        held: body.held,
        helpOpen: body.helpOpen,
        ...body.reason === "person" ? { reason: "person" } : {},
        ...typeof body.blockedReason === "string" && body.blockedReason.trim() ? { blockedReason: body.blockedReason } : {}
      };
    } catch {
      return UNCONFIRMED;
    }
  }
  return {
    configured,
    async state(fresh = false) {
      if (!configured) return DISENGAGED;
      const now = Date.now();
      if (!fresh && now - cachedAt < cacheMs) return cached2;
      cached2 = await read();
      cachedAt = Date.now();
      return cached2;
    }
  };
}

// server/env-path.ts
import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, join } from "node:path";
function nvmBinDirs() {
  try {
    const base = join(homedir(), ".nvm", "versions", "node");
    return readdirSync(base).filter((v) => v.startsWith("v")).sort((a, b) => b.localeCompare(a, void 0, { numeric: true })).map((v) => join(base, v, "bin"));
  } catch {
    return [];
  }
}
function sealedFixture() {
  return process.env.OMB_TEST_SEALED_PATH === "1";
}
function knownDirs() {
  const home = homedir();
  return [
    join(home, ".local", "bin"),
    // claude installer default
    join(home, ".npm-global", "bin"),
    // npm prefix ~/.npm-global (claude, opencode)
    join(home, ".kimi-code", "bin"),
    // kimi-code installer
    join(home, ".grok", "bin"),
    // x.ai installer
    join(home, ".opencode", "bin"),
    // opencode installer
    join(home, ".claude", "local"),
    // claude "local install"
    ...sealedFixture() ? [] : [
      "/opt/homebrew/bin",
      // brew, Apple silicon
      "/usr/local/bin"
      // brew Intel / classic installs
    ],
    join(home, ".volta", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".local", "share", "mise", "shims"),
    // mise installer
    join(home, ".deno", "bin"),
    join(home, "bin"),
    ...nvmBinDirs()
  ];
}
function windowsKnownDirs() {
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  return [
    join(appData, "npm"),
    // npm -g shims: claude, codex
    join(home, ".kimi-code", "bin"),
    // recover Kimi installs after a GUI launch too
    join(home, ".grok", "bin"),
    // x.ai installer
    join(localAppData, "agy", "bin"),
    // Antigravity installer
    // Cursor installer: cursor-agent.* and its `agent` copies
    join(localAppData, "cursor-agent"),
    join(home, ".local", "bin"),
    // claude native installer
    join(home, ".claude", "local"),
    join(home, "bin"),
    // Factory droid installer (%USERPROFILE%\bin)
    join(home, ".bun", "bin"),
    join(home, ".deno", "bin"),
    join(home, "go", "bin"),
    join(programFiles, "Docker", "Docker", "resources", "bin"),
    // Docker Desktop installer
    join(programFiles, "RedHat", "Podman")
    // Podman installer, also run by Podman Desktop
  ];
}
var cached = null;
var probed = false;
var loginShellPath = null;
var registeredDirs = [];
function augmentedPath() {
  if (cached === null) {
    cached = mergePaths([
      ...registeredDirs.filter((d) => existsSync(d)),
      ...process.env.OMB_EXTRA_PATH ? process.env.OMB_EXTRA_PATH.split(delimiter) : [],
      ...process.env.PATH ? process.env.PATH.split(delimiter) : [],
      // Keep the last login-shell result while a rescan re-probes, or rc-only CLIs vanish for the response that triggered it.
      ...loginShellPath ? loginShellPath.split(delimiter) : [],
      ...(process.platform === "win32" ? windowsKnownDirs() : knownDirs()).filter((d) => existsSync(d))
    ]);
  }
  if (!probed && !process.env.VITEST && !sealedFixture() && process.platform !== "win32") {
    probed = true;
    probeLoginShellPath();
  }
  return cached;
}
function mergePaths(parts) {
  return [...new Set(parts.filter(Boolean))].join(delimiter);
}
function probeLoginShellPath() {
  const shell = process.env.SHELL || "/bin/zsh";
  execFile(
    shell,
    ["-l", "-i", "-c", 'printf "__OMB_PATH__%s" "$PATH"'],
    { timeout: 5e3 },
    (err, stdout) => {
      if (err || !stdout) return;
      const m = /__OMB_PATH__([^\n]*)/.exec(stdout);
      if (!m || !m[1]) return;
      loginShellPath = m[1];
      cached = mergePaths([...(cached ?? "").split(delimiter), ...m[1].split(delimiter)]);
    }
  );
}
function splitCliString(cli) {
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of cli.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}
function isFile(p) {
  try {
    return statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}
function whichWin(cli, env) {
  const exts = ((env ?? process.env).PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const probe = (base) => {
    const order = extname(base) ? [base, ...exts.map((e) => base + e)] : [...exts.map((e) => base + e), base];
    return order.find(isFile) ?? null;
  };
  if (/[\\/]/.test(cli) || /^[a-zA-Z]:/.test(cli)) return probe(cli);
  const path = env ? env.PATH ?? env.Path ?? "" : augmentedPath();
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const hit = probe(join(dir, cli));
    if (hit) return hit;
  }
  return null;
}
function nodeExe(near, env) {
  const local = join(near, "node.exe");
  if (isFile(local)) return local;
  const onPath = whichWin("node.exe", env);
  if (onPath && extname(onPath).toLowerCase() === ".exe") return onPath;
  return process.versions.electron ? null : process.execPath;
}
function parseCmdShim(shim, env) {
  let text;
  try {
    text = readFileSync(shim, "utf8");
  } catch {
    return null;
  }
  const dir = dirname(shim);
  const npmEntry = /^SET "NP[MX]_CLI_JS=%~dp0\\([^"]+)"/im.exec(text);
  const targets = [...npmEntry ? [npmEntry] : [], ...text.matchAll(/"%~?dp0%?\\?([^"]+)"/g)].map((m) => join(dir, m[1])).filter((p) => isFile(p) && basename(p).toLowerCase() !== "node.exe");
  const script = targets.find((p) => /\.[cm]?js$/i.test(p));
  if (script) {
    const node = nodeExe(dir, env);
    if (node) return { command: node, args: [script] };
  }
  const exe = targets.find((p) => extname(p).toLowerCase() === ".exe");
  return exe ? { command: exe, args: [] } : null;
}
function parseNodeShebang(file, env) {
  let head = "";
  let fd = null;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(128);
    const n = readSync(fd, buf, 0, buf.length, 0);
    head = buf.subarray(0, n).toString("utf8").split("\n", 1)[0];
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
      }
    }
  }
  if (!/^#!.*\bnode(\.exe)?\b/.test(head)) return null;
  const node = nodeExe(dirname(file), env);
  return node ? { command: node, args: [file] } : null;
}
function resolveWord(cli, args2, env) {
  if (process.platform !== "win32") return { command: cli, args: args2 };
  const file = whichWin(cli, env);
  if (!file) return { command: cli, args: args2 };
  const ext = extname(file).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    const direct = parseCmdShim(file, env);
    return direct ? { command: direct.command, args: [...direct.args, ...args2] } : { command: file, args: args2 };
  }
  if (ext === ".exe" || ext === ".com") return { command: file, args: args2 };
  const viaNode = parseNodeShebang(file, env);
  return viaNode ? { command: viaNode.command, args: [...viaNode.args, ...args2] } : { command: file, args: args2 };
}
function resolveCliSpawn(cli, args2, env) {
  const trimmed = cli.trim();
  if (trimmed.includes(" ") && existsSync(trimmed)) return resolveWord(trimmed, args2, env);
  const split = splitCliString(cli);
  if (split.length > 1 || split[0] !== trimmed) {
    const [head, ...fixed] = split;
    if (!head) return { command: cli, args: args2 };
    return resolveWord(head, [...fixed, ...args2], env);
  }
  return resolveWord(cli, args2, env);
}

// server/mcp-error-result.ts
var ERROR_FLAG = /"isError"\s*:\s*true/u;
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
var READ_AGAIN = "an error result can carry only text. Call get_window_state for that window and take x,y from its new screenshot before any pixel action.";
var PROMISED_SCREENSHOT = /;\s*one follows, take x,y from it/gu;
function omittedFromErrorNote(count) {
  return count === 1 ? `[The screenshot this error mentions was removed: ${READ_AGAIN}]` : `[The ${count} screenshots or other attachments this error mentions were removed: ${READ_AGAIN}]`;
}
function textOnlyErrorResult(result) {
  if (!isObject(result) || result.isError !== true || !Array.isArray(result.content)) return result;
  const text = result.content.filter((item) => isObject(item) && item.type === "text" && typeof item.text === "string");
  const omitted = result.content.length - text.length;
  if (omitted === 0) return result;
  const kept = text.map((item) => ({ ...item, text: item.text.replace(PROMISED_SCREENSHOT, "; that screenshot was removed from this error") }));
  return { ...result, content: [...kept, { type: "text", text: omittedFromErrorNote(omitted) }] };
}
function textOnlyErrorResultLine(line) {
  if (!ERROR_FLAG.test(line)) return line;
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return line;
  }
  if (!isObject(frame)) return line;
  const result = textOnlyErrorResult(frame.result);
  return result === frame.result ? line : JSON.stringify({ ...frame, result });
}

// server/tool-schema-profile.ts
var PROFILES = {
  // Moonshot refuses the whole request when one tool's `function.parameters`, as Go's encoding/json writes it, passes an
  // undocumented size (about 13.7 KB accepted, 15 KB refused): https://github.com/MoonshotAI/kimi-code/issues/4231,
  // https://github.com/morluto/rea/issues/3654. Depth 30 is walle's default (https://github.com/MoonshotAI/walle/blob/main/conf.go).
  // Kimi Code inlines every local $ref first (normalizeKimiToolSchema in MoonshotAI/kimi-code packages/kosong).
  moonshot: { id: "moonshot", provider: "Kimi", maxSchemaBytes: 12e3, maxDepth: 30, measureInlined: true }
};
var TOOL_SCHEMA_PROFILE_ENV = "OMB_TOOL_SCHEMA_PROFILE";
function toolSchemaProfile(id) {
  return typeof id === "string" && Object.hasOwn(PROFILES, id) ? PROFILES[id] : void 0;
}
function toolSchemaProfileFromEnv(env = process.env) {
  return toolSchemaProfile(env[TOOL_SCHEMA_PROFILE_ENV]);
}
function isObject2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function schemaBytes(value) {
  const text = JSON.stringify(value) ?? "";
  return Buffer.byteLength(text) + 5 * (text.match(/[<>&]/g)?.length ?? 0) + 3 * (text.match(/[\u2028\u2029]/g)?.length ?? 0);
}
var MAP_SLOTS = ["properties", "patternProperties", "dependentSchemas", "$defs", "definitions"];
var NESTED_SLOTS = ["additionalProperties", "items", "additionalItems", "contains", "propertyNames", "unevaluatedProperties", "unevaluatedItems"];
var NESTED_LISTS = ["prefixItems", "items"];
var ALTERNATIVE_LISTS = ["anyOf", "oneOf", "allOf"];
var ALTERNATIVES = ["not", "if", "then", "else"];
function walk(node, depth, visit) {
  if (!isObject2(node)) return;
  visit(node, depth);
  for (const slot of MAP_SLOTS) if (isObject2(node[slot])) for (const child of Object.values(node[slot])) walk(child, depth + 1, visit);
  for (const slot of NESTED_SLOTS) walk(node[slot], depth + 1, visit);
  for (const slot of NESTED_LISTS) if (Array.isArray(node[slot])) for (const item of node[slot]) walk(item, depth + 1, visit);
  for (const slot of ALTERNATIVE_LISTS) if (Array.isArray(node[slot])) for (const item of node[slot]) walk(item, depth, visit);
  for (const slot of ALTERNATIVES) walk(node[slot], depth, visit);
}
function schemaDepth(schema) {
  let deepest = 0;
  walk(schema, 0, (_node, depth) => {
    deepest = Math.max(deepest, depth);
  });
  return deepest;
}
function pointer(root, ref) {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return void 0;
  let current = root;
  for (const raw of ref.slice(2).split("/")) {
    const part = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current) && /^(?:0|[1-9]\d*)$/.test(part)) current = current[Number(part)];
    else if (isObject2(current) && Object.hasOwn(current, part)) current = current[part];
    else return void 0;
  }
  return current;
}
function dropUnusedDefinitions(schema) {
  const rest = JSON.stringify(Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$defs" && key !== "definitions")));
  for (const bucket of ["$defs", "definitions"]) if (!rest.includes(`"#/${bucket}/`)) delete schema[bucket];
}
var INLINE_NODE_BUDGET = 2e5;
function inlineRefs(schema) {
  let nodes = 0;
  const resolve = (node, stack) => {
    if (++nodes > INLINE_NODE_BUDGET) throw new RangeError("inline budget");
    if (Array.isArray(node)) return node.map((item) => resolve(item, stack));
    if (!isObject2(node)) return node;
    const ref = node.$ref;
    const target = typeof ref === "string" && !stack.has(ref) ? pointer(schema, ref) : void 0;
    if (typeof ref === "string" && target !== void 0) {
      stack.add(ref);
      const resolved = resolve(target, stack);
      stack.delete(ref);
      if (!isObject2(resolved)) return resolved;
      const merged = { ...resolved };
      for (const [key, value] of Object.entries(node)) if (key !== "$ref") merged[key] = resolve(value, stack);
      return merged;
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, resolve(value, stack)]));
  };
  try {
    const inlined = resolve(schema, /* @__PURE__ */ new Set());
    dropUnusedDefinitions(inlined);
    return inlined;
  } catch (error) {
    if (error instanceof RangeError) return void 0;
    throw error;
  }
}
function fits(schema, profile) {
  return schemaBytes(schema) <= profile.maxSchemaBytes && schemaDepth(schema) <= profile.maxDepth;
}
var ANNOTATIONS = /* @__PURE__ */ new Set(["examples", "example", "$comment", "title", "deprecated", "readOnly", "writeOnly", "$schema", "$id"]);
function stripAnnotations(schema) {
  walk(schema, 0, (node) => {
    for (const key of Object.keys(node)) if (ANNOTATIONS.has(key) || key.startsWith("x-")) delete node[key];
  });
}
function shortened(text, chars) {
  if (typeof text !== "string" || !text.trim() || chars <= 0) return void 0;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= chars ? flat : `${flat.slice(0, chars - 1).replace(/\s+\S*$/, "")}\u2026`;
}
function shortenDescriptions(schema, fromDepth, chars) {
  walk(schema, 0, (node, depth) => {
    if (depth < fromDepth) return;
    const description = shortened(node.description, chars);
    if (description) node.description = description;
    else delete node.description;
  });
}
var JSON_TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"];
function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value === "object" ? "object" : typeof value;
}
function typesOf(node, root, hops = 0) {
  if (hops > 16) return [];
  if (typeof node.type === "string") return [node.type];
  if (Array.isArray(node.type)) return node.type.filter((type) => typeof type === "string");
  const target = typeof node.$ref === "string" ? pointer(root, node.$ref) : void 0;
  if (isObject2(target)) return typesOf(target, root, hops + 1);
  const branches2 = ALTERNATIVE_LISTS.flatMap((slot) => Array.isArray(node[slot]) ? node[slot].filter(isObject2) : []);
  if (branches2.length) return [...new Set(branches2.flatMap((branch) => typesOf(branch, root, hops + 1)))];
  if (Array.isArray(node.enum) && node.enum.length) return [...new Set(node.enum.map(valueType))];
  if ("const" in node) return [valueType(node.const)];
  if (isObject2(node.properties) || "additionalProperties" in node || Array.isArray(node.required)) return ["object"];
  if ("items" in node || "prefixItems" in node) return ["array"];
  return [];
}
function placeholder(node, root) {
  const types = typesOf(node, root).filter((type2) => JSON_TYPES.includes(type2));
  const unique = [...new Set(types.map((type2) => type2 === "integer" && types.includes("number") ? "number" : type2))];
  if (unique.length !== 1) return { type: unique.length ? unique : JSON_TYPES };
  const type = unique[0];
  if (type === "object") return { type, additionalProperties: true };
  const choices = Array.isArray(node.enum) ? node.enum : "const" in node ? [node.const] : void 0;
  const sameType = (value) => valueType(value) === type || type === "number" && valueType(value) === "integer";
  const keep = type !== "array" && choices && choices.length <= 64 && choices.every(sameType) && schemaBytes(choices) <= 1024;
  return keep ? { type, enum: choices } : { type };
}
function collapseAt(schema, depth) {
  walk(schema, 0, (node, at) => {
    if (at !== depth - 1) return;
    for (const slot of MAP_SLOTS) {
      const map = node[slot];
      if (isObject2(map)) {
        for (const [key, child] of Object.entries(map)) if (isObject2(child)) map[key] = placeholder(child, schema);
      }
    }
    for (const slot of NESTED_SLOTS) if (isObject2(node[slot])) node[slot] = placeholder(node[slot], schema);
    for (const slot of NESTED_LISTS) {
      const list = node[slot];
      if (Array.isArray(list)) list.forEach((item, index) => {
        if (isObject2(item)) list[index] = placeholder(item, schema);
      });
    }
  });
  dropUnusedDefinitions(schema);
}
function topLevelOnly(schema, descriptionChars) {
  const declared = isObject2(schema.properties) ? schema.properties : {};
  const properties = {};
  for (const [key, child] of Object.entries(declared)) {
    const flat = isObject2(child) ? placeholder(child, schema) : { type: JSON_TYPES };
    const description = isObject2(child) ? shortened(child.description, descriptionChars) : void 0;
    properties[key] = description ? { ...flat, description } : flat;
  }
  const required = Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string" && Object.hasOwn(properties, key)) : [];
  return { type: "object", properties, ...required.length ? { required } : {}, additionalProperties: true };
}
function fitToolSchema(schema, profile) {
  const measured = profile.measureInlined ? inlineRefs(schema) : schema;
  const from = schemaBytes(measured ?? schema);
  if (measured && fits(measured, profile)) return { outcome: "kept", schema, bytes: from };
  const fitted = (outcome, form) => ({ outcome, schema: form, bytes: schemaBytes(form), from });
  const working = structuredClone(measured ?? schema);
  if (measured) {
    stripAnnotations(working);
    if (fits(working, profile)) return fitted("trimmed", working);
    for (let depth = schemaDepth(working); depth >= 2; depth -= 1) {
      shortenDescriptions(working, depth, 0);
      if (fits(working, profile)) return fitted("trimmed", working);
    }
    shortenDescriptions(working, 0, 300);
    if (fits(working, profile)) return fitted("trimmed", working);
    for (let depth = schemaDepth(working); depth >= 2; depth -= 1) {
      collapseAt(working, depth);
      if (fits(working, profile)) return fitted("loosened", working);
    }
  }
  for (const chars of [120, 0]) {
    const top = topLevelOnly(working, chars);
    if (fits(top, profile)) return fitted("minimal", top);
  }
  return { outcome: "dropped", bytes: schemaBytes(topLevelOnly(working, 0)), from };
}

// server/mcp-tool-schema.ts
var ROOT_COMBINATORS = ["anyOf", "oneOf", "allOf", "not"];
function isObject3(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function branches(value) {
  return Array.isArray(value) ? value.filter(isObject3) : [];
}
function objectShape(schema) {
  const properties = isObject3(schema.properties) ? { ...schema.properties } : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : []);
  const adopt = (shape) => {
    for (const [key, value] of Object.entries(shape.properties)) if (!(key in properties)) properties[key] = value;
  };
  for (const branch of branches(schema.allOf)) {
    const shape = objectShape(branch);
    adopt(shape);
    for (const key of shape.required) required.add(key);
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const choices = branches(schema[keyword]).map(objectShape);
    if (choices.length === 0) continue;
    for (const choice of choices) adopt(choice);
    for (const key of choices[0].required) {
      if (choices.every((choice) => choice.required.includes(key))) required.add(key);
    }
  }
  return { properties, required: [...required] };
}
function describesObject(type) {
  return type === void 0 || type === "object" || Array.isArray(type) && type.includes("object");
}
function providerSafeInputSchema(schema) {
  if (!isObject3(schema) || !describesObject(schema.type)) return { type: "object", properties: {} };
  if (schema.type === "object" && ROOT_COMBINATORS.every((keyword) => !(keyword in schema))) return schema;
  const { properties, required } = objectShape(schema);
  const safe = { ...schema, type: "object", properties };
  for (const keyword of ROOT_COMBINATORS) delete safe[keyword];
  if (required.length > 0) safe.required = required;
  else delete safe.required;
  return safe;
}
function toolName(tool) {
  return typeof tool.name === "string" && tool.name ? tool.name : "unnamed";
}
function shortenedToolNote(provider) {
  return `(SpokyBot shortened this tool's parameters to fit ${provider}'s size limit for one tool: give any field it no longer lists as this description says. The tool still checks every call against its full schema.)`;
}
function fitToolList(tools, profile, log = () => {
}) {
  const fitted = [];
  for (const tool of tools) {
    if (!isObject3(tool)) {
      fitted.push(tool);
      continue;
    }
    const rooted = providerSafeInputSchema(tool.inputSchema);
    const fit = fitToolSchema(rooted, profile);
    const name = toolName(tool);
    const limit = `${profile.provider}'s ${profile.maxSchemaBytes}-byte limit for one tool`;
    if (fit.outcome === "dropped") {
      log(`left out tool "${name}": its parameters are ${fit.from} bytes and still ${fit.bytes} at their shortest, over ${limit}`);
      continue;
    }
    if (fit.outcome === "kept") {
      fitted.push(fit.schema === tool.inputSchema ? tool : { ...tool, inputSchema: fit.schema });
      continue;
    }
    const what = { trimmed: "shortened the descriptions in", loosened: "left nested fields out of", minimal: "kept only the top-level fields of" }[fit.outcome];
    log(`${what} tool "${name}"'s parameters (${fit.from} to ${fit.bytes} bytes) to fit ${limit}`);
    if (fit.outcome === "trimmed") {
      fitted.push({ ...tool, inputSchema: fit.schema });
      continue;
    }
    const description = typeof tool.description === "string" && tool.description.trim() ? `${tool.description.trimEnd()}

` : "";
    fitted.push({ ...tool, description: description + shortenedToolNote(profile.provider), inputSchema: fit.schema });
  }
  return fitted;
}
function createToolListNormalizer(profile, log) {
  const pending = /* @__PURE__ */ new Set();
  const idKey = (id) => `${typeof id}:${String(id)}`;
  return {
    observeRequest(line) {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (isObject3(frame) && frame.method === "tools/list" && (typeof frame.id === "number" || typeof frame.id === "string")) {
        pending.add(idKey(frame.id));
      }
    },
    rewriteResponse(line) {
      if (pending.size === 0) return line;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return line;
      }
      if (!isObject3(frame) || "method" in frame || !pending.delete(idKey(frame.id))) return line;
      if (!isObject3(frame.result) || !Array.isArray(frame.result.tools)) return line;
      const listed = frame.result.tools;
      const tools = profile ? fitToolList(listed, profile, log) : listed.map((tool) => {
        if (!isObject3(tool)) return tool;
        const inputSchema = providerSafeInputSchema(tool.inputSchema);
        return inputSchema === tool.inputSchema ? tool : { ...tool, inputSchema };
      });
      const changed = tools.length !== listed.length || tools.some((tool, index) => tool !== listed[index]);
      return changed ? JSON.stringify({ ...frame, result: { ...frame.result, tools } }) : line;
    }
  };
}

// server/mcp-bridge.ts
var BRIDGE_INACTIVITY_MS = 45e3;
var PROBE_TIMEOUT_MS = 1e4;
function runLivenessProbe(probe, timeoutMs = PROBE_TIMEOUT_MS, env) {
  return new Promise((resolve) => {
    const child = spawn(probe.command, probe.args, {
      shell: false,
      env: env ?? { ...process.env, PATH: augmentedPath() },
      stdio: ["ignore", "ignore", "ignore"]
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
function createInactivityWatchdog(options) {
  let timer = null;
  let stopped = false;
  let probing = false;
  let touchedWhileProbing = false;
  const arm = () => {
    if (stopped) return;
    timer = setTimeout(fire, options.inactivityMs);
    timer.unref?.();
  };
  const settleProbe = (alive) => {
    probing = false;
    if (stopped) return;
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
      if (stopped) return;
      if (probing) {
        touchedWhileProbing = true;
        return;
      }
      if (timer) clearTimeout(timer);
      arm();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}
function createLineSplitter(onLine) {
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
      if (pending) onLine(pending);
      pending = "";
    }
  };
}
function createGateInterceptor(options) {
  const actWithinMs = options.actWithinMs ?? CONTROL_ACT_WITHIN_MS;
  let queue = Promise.resolve();
  return (line) => {
    const arrivedAt = Date.now();
    queue = queue.then(async () => {
      let frame = null;
      try {
        frame = JSON.parse(line);
      } catch {
      }
      if (!frame || frame.method !== "tools/call") {
        options.forward(line);
        return;
      }
      const state = await options.check().catch(() => ({ held: true, helpOpen: false, blockedReason: CONTROL_UNCONFIRMED }));
      if (!state.held && Date.now() - arrivedAt <= actWithinMs) {
        options.forward(line);
        return;
      }
      options.refuse(
        JSON.stringify({
          jsonrpc: "2.0",
          id: frame.id ?? null,
          result: { content: [{ type: "text", text: state.held ? controlRefusal(state) : CONTROL_WAITED }], isError: true }
        })
      );
    });
    return queue;
  };
}
function createMcpBridgeInterceptor(options) {
  const afterPing = options.gate ? createGateInterceptor({ check: options.gate.check, forward: options.forward, refuse: options.answer }) : (line) => {
    options.forward(line);
  };
  return (line) => {
    let frame = null;
    try {
      frame = JSON.parse(line);
    } catch {
    }
    if (frame && frame.method === "ping") {
      if (frame.id !== void 0) {
        options.answer(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }));
      }
      return;
    }
    return afterPing(line);
  };
}
function runMcpBridge(options) {
  const env = options.env ?? { ...process.env, PATH: augmentedPath() };
  const { command: command2, args: args2 } = resolveCliSpawn(options.command, options.args, env);
  const child = spawn(command2, args2, {
    shell: false,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin.on("error", () => {
  });
  child.stderr.pipe(process.stderr);
  const client = options.gate ? createControlClient({ url: options.gate.url, token: options.gate.token }) : null;
  const answer = (line) => process.stdout.write(line + "\n");
  const forward = (line) => child.stdin.write(line + "\n");
  const intercept = createMcpBridgeInterceptor({
    answer,
    forward,
    ...client ? { gate: { check: () => client.state(true) } } : {}
  });
  const toolLists = createToolListNormalizer(toolSchemaProfileFromEnv(), (line) => process.stderr.write(`${options.label}: ${line}
`));
  let pendingInput = Promise.resolve();
  const inbound = createLineSplitter((line) => {
    toolLists.observeRequest(line);
    const completion = intercept(line);
    if (completion) pendingInput = completion;
  });
  const onStdin = (chunk) => inbound.push(chunk);
  process.stdin.on("data", onStdin);
  process.stdin.on("end", () => {
    inbound.flush();
    void pendingInput.finally(() => child.stdin.end());
  });
  const outbound = createLineSplitter((line) => process.stdout.write(textOnlyErrorResultLine(toolLists.rewriteResponse(line)) + "\n"));
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
        process.stderr.write(
          `${options.label} transport went silent and stopped answering liveness probes; ending the bridge
`
        );
        process.exitCode = 1;
        detach();
        child.kill("SIGKILL");
        const failsafe = setTimeout(() => process.exit(1), 2e3);
        failsafe.unref?.();
      }
    });
    const touch = () => watchdog?.touch();
    process.stdin.on("data", touch);
    child.stdout.on("data", touch);
    child.stderr.on("data", touch);
  }
  child.on("error", (error) => {
    process.stderr.write(`could not connect to ${options.label}: ${error.message}
`);
    process.exitCode = 1;
    watchdog?.stop();
    detach();
  });
  child.on("close", (code, signal) => {
    if (signal) process.stderr.write(`${options.label} connection ended with ${signal}
`);
    process.exitCode = process.exitCode ?? code ?? 1;
    watchdog?.stop();
    detach();
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => child.kill(signal));
  }
}

// server/local-computer-proxy.ts
var {
  OMB_CUA_COMMAND: command,
  OMB_CUA_ARGS: encodedArgs,
  OMB_CONTROL_URL: url,
  OMB_CONTROL_TOKEN: token,
  ...childEnv
} = process.env;
var args;
try {
  const parsed = JSON.parse(encodedArgs ?? "");
  const endpoint = new URL(url ?? "");
  if (!command?.trim() || command.includes("\0") || !Array.isArray(parsed) || !parsed.every((arg) => typeof arg === "string" && !arg.includes("\0")) || !token || !["http:", "https:"].includes(endpoint.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || endpoint.username || endpoint.password) {
    throw new Error("invalid connection");
  }
  args = parsed;
} catch {
  process.stderr.write("invalid local computer proxy connection\n");
  process.exit(2);
}
runMcpBridge({
  command,
  args,
  env: { ...childEnv, PATH: augmentedPath() },
  label: "Local Cua Driver",
  gate: { url, token }
});
