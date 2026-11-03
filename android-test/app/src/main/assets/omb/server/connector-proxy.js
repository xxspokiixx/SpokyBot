import { createRequire as __ombCreateRequire } from "node:module";
const require = __ombCreateRequire(import.meta.url);

// server/connector-proxy.ts
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// shared/wire.ts
var CONNECTOR_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/;
var CONNECTOR_TOOL_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

// server/connector-verdict.ts
var COMPOSIO_MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";
function serviceSlugFor(tool) {
  const underscore = tool.indexOf("_");
  if (underscore <= 0) return null;
  return tool.slice(0, underscore).toLowerCase();
}
function serviceSlugForCandidates(tool, candidates) {
  let match = null;
  for (const candidate of candidates) {
    if (tool.startsWith(candidate.toUpperCase() + "_") && (match === null || candidate.length > match.length)) {
      match = candidate;
    }
  }
  return match;
}
function connectorCallFromFrame(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { kind: "passthrough" };
  const frame = payload;
  if (frame.method !== "tools/call") return { kind: "passthrough" };
  const params = frame.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { kind: "unrecognized", invoked: "tools/call", reason: "the call carried no params object" };
  }
  const name = params.name;
  if (typeof name !== "string" || !name) {
    return { kind: "unrecognized", invoked: "tools/call", reason: "the call named no tool" };
  }
  if (name === COMPOSIO_MULTI_EXECUTE_TOOL) {
    return multiExecuteCall(name, params.arguments);
  }
  if (name.startsWith("COMPOSIO_")) return { kind: "passthrough" };
  if (name.endsWith("_MANAGE_CONNECTIONS") || name.endsWith("_WAIT_FOR_CONNECTIONS")) {
    return { kind: "passthrough" };
  }
  if (!CONNECTOR_TOOL_NAME_PATTERN.test(name)) {
    return { kind: "unrecognized", invoked: name, reason: "the tool name is not a Composio tool name" };
  }
  return { kind: "tools", invoked: name, names: [name] };
}
function multiExecuteCall(invoked, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { kind: "unrecognized", invoked, reason: "the arguments were not an object" };
  }
  const tools = args.tools;
  const singleSlug = args.tool_slug;
  if (Array.isArray(tools)) {
    if (tools.length === 0) {
      return { kind: "unrecognized", invoked, reason: "the tools list was empty" };
    }
    const names = [];
    for (const item of tools) {
      const slug = item && typeof item === "object" && !Array.isArray(item) ? item.tool_slug : void 0;
      if (typeof slug !== "string" || !slug) {
        return { kind: "unrecognized", invoked, reason: "an entry in the tools list named no tool_slug" };
      }
      names.push(slug);
    }
    return { kind: "tools", invoked, names };
  }
  if (typeof singleSlug === "string" && singleSlug) {
    return { kind: "tools", invoked, names: [singleSlug] };
  }
  return { kind: "unrecognized", invoked, reason: "the arguments named no tools to execute" };
}

// server/connector-advertisement.ts
var CONNECTOR_ALLOWED_TOOLS_ENV = "OMB_CONNECTOR_ALLOWED_TOOLS";
var CONNECTOR_SERVICE_SLUGS_ENV = "OMB_CONNECTOR_SERVICE_SLUGS";
var CONNECTOR_ALLOWED_TOOLS_MAX_BYTES = 32 * 1024;
var CONNECTOR_SERVICE_SLUGS_MAX_BYTES = 32 * 1024;
var CONNECTOR_META_TOOLS = [
  "COMPOSIO_SEARCH_TOOLS",
  "COMPOSIO_GET_TOOL_SCHEMAS",
  "COMPOSIO_MULTI_EXECUTE_TOOL",
  // Composio ships COMPOSIO_MANAGE_CONNECTIONS in every session; COMPOSIO_WAIT_FOR_CONNECTIONS is opt-in and off by default.
  // The filter keeps only names upstream lists, so advertising an opted-out one changes nothing.
  "COMPOSIO_MANAGE_CONNECTIONS",
  "COMPOSIO_WAIT_FOR_CONNECTIONS"
];
var CONNECTION_TOOL_SUFFIXES = ["_MANAGE_CONNECTIONS", "_WAIT_FOR_CONNECTIONS"];
function parseConnectorAllowedToolsEnv(raw) {
  if (!raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const grants = {};
  for (const [slug, grant] of Object.entries(value)) {
    if (!CONNECTOR_SLUG_PATTERN.test(slug)) return null;
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) return null;
    const tools = grant.tools;
    if (tools === "*") {
      grants[slug] = { tools: "*" };
      continue;
    }
    if (!Array.isArray(tools) || tools.length === 0) return null;
    if (!tools.every((tool) => typeof tool === "string" && CONNECTOR_TOOL_NAME_PATTERN.test(tool))) {
      return null;
    }
    grants[slug] = { tools };
  }
  return grants;
}
function parseConnectorServiceSlugsEnv(raw) {
  if (!raw) return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.every((slug) => typeof slug === "string" && CONNECTOR_SLUG_PATTERN.test(slug)) ? value : [];
}
function connectorToolAdvertised(name, grants, candidates = []) {
  if (name === "COMPOSIO_MANAGE_CONNECTIONS") return true;
  if (Object.keys(grants).length > 0 && CONNECTOR_META_TOOLS.includes(name)) return true;
  const service = serviceSlugForCandidates(name, candidates) ?? serviceSlugFor(name);
  const grant = service === null ? void 0 : grants[service];
  if (!grant) return false;
  if (grant.tools === "*") return true;
  if (grant.tools.includes(name)) return true;
  return CONNECTION_TOOL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}
function filterToolsListFrame(frame, grants, candidates = []) {
  const result = frame.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return frame;
  const tools = result.tools;
  if (!Array.isArray(tools)) return frame;
  const kept = tools.filter((tool) => {
    const name = tool && typeof tool === "object" && !Array.isArray(tool) ? tool.name : void 0;
    return typeof name === "string" ? connectorToolAdvertised(name, grants, candidates) : true;
  });
  return { ...frame, result: { ...result, tools: kept } };
}

// server/connector-scope-hint.ts
function collectRefusals(node, slug, found, pattern) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefusals(item, slug, found, pattern);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node;
  const own = [record.tool_slug, record.slug].find((value) => typeof value === "string" && value !== "") ?? slug;
  const before = found.length;
  for (const value of Object.values(record)) collectRefusals(value, own, found, pattern);
  if (found.length > before) return;
  const hasError = record.error !== void 0 && record.error !== null && record.error !== "";
  const failed = record.successful === false || hasError && record.successful !== true;
  if (failed && pattern.test(JSON.stringify(record.successful === false ? record : record.error))) found.push(own);
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function annotateFailedCall(frame, pattern, hint, slugs) {
  const result = frame?.result;
  if (!result || !Array.isArray(result.content)) return false;
  const texts = result.content.flatMap((item) => {
    const text = item?.text;
    return typeof text === "string" ? [text] : [];
  });
  const refusals = [];
  for (const text of texts) collectRefusals(parseJson(text), null, refusals, pattern);
  if (!refusals.length && result.isError === true && texts.some((text) => pattern.test(text))) refusals.push(null);
  if (!refusals.length) return false;
  const named = refusals.filter((slug) => slug !== null);
  result.content.push({ type: "text", text: hint(named.length ? named : slugs) });
  return true;
}

// server/connector-signed-out-hint.ts
var SIGNED_OUT = /USER_NOT_LOGGED_IN|not logged in|no (?:active )?connected account|connected account (?:not found|is not active|is inactive|has expired)|invalid authentication credentials|\bunauthenticated\b|\b401\b|invalid_grant/i;
function signedOutHint(services) {
  const apps = services.length ? services.join(", ") : "The app";
  const target = services.length ? `with toolkits ${JSON.stringify(services)}` : "for that app";
  return `SpokyBot note: ${apps} is signed out (its sign-in expired or was revoked), so this call did not run. Call COMPOSIO_MANAGE_CONNECTIONS ${target} to show the person a card that reconnects it, then end this turn. Do not retry this call before they reconnect.`;
}
function withSignedOutHint(request, response, connectedServices) {
  const call = connectorCallFromFrame(request);
  const services = (tools) => [...new Set(tools.flatMap((tool) => {
    const service = tool.startsWith("COMPOSIO_") ? null : serviceSlugForCandidates(tool, connectedServices) ?? serviceSlugFor(tool);
    return service ? [service] : [];
  }))];
  annotateFailedCall(response, SIGNED_OUT, (failed) => signedOutHint(services(failed)), call.kind === "tools" ? call.names : []);
  return response;
}

// shared/connector-availability.ts
var AUTH_CONFIG_ID = /^ac_[A-Za-z0-9_-]{4,64}$/;

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
function isObject(value) {
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
  if (!isObject(node)) return;
  visit(node, depth);
  for (const slot of MAP_SLOTS) if (isObject(node[slot])) for (const child of Object.values(node[slot])) walk(child, depth + 1, visit);
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
    else if (isObject(current) && Object.hasOwn(current, part)) current = current[part];
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
    if (!isObject(node)) return node;
    const ref = node.$ref;
    const target = typeof ref === "string" && !stack.has(ref) ? pointer(schema, ref) : void 0;
    if (typeof ref === "string" && target !== void 0) {
      stack.add(ref);
      const resolved = resolve(target, stack);
      stack.delete(ref);
      if (!isObject(resolved)) return resolved;
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
  if (isObject(target)) return typesOf(target, root, hops + 1);
  const branches2 = ALTERNATIVE_LISTS.flatMap((slot) => Array.isArray(node[slot]) ? node[slot].filter(isObject) : []);
  if (branches2.length) return [...new Set(branches2.flatMap((branch) => typesOf(branch, root, hops + 1)))];
  if (Array.isArray(node.enum) && node.enum.length) return [...new Set(node.enum.map(valueType))];
  if ("const" in node) return [valueType(node.const)];
  if (isObject(node.properties) || "additionalProperties" in node || Array.isArray(node.required)) return ["object"];
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
      if (isObject(map)) {
        for (const [key, child] of Object.entries(map)) if (isObject(child)) map[key] = placeholder(child, schema);
      }
    }
    for (const slot of NESTED_SLOTS) if (isObject(node[slot])) node[slot] = placeholder(node[slot], schema);
    for (const slot of NESTED_LISTS) {
      const list = node[slot];
      if (Array.isArray(list)) list.forEach((item, index) => {
        if (isObject(item)) list[index] = placeholder(item, schema);
      });
    }
  });
  dropUnusedDefinitions(schema);
}
function topLevelOnly(schema, descriptionChars) {
  const declared = isObject(schema.properties) ? schema.properties : {};
  const properties = {};
  for (const [key, child] of Object.entries(declared)) {
    const flat = isObject(child) ? placeholder(child, schema) : { type: JSON_TYPES };
    const description = isObject(child) ? shortened(child.description, descriptionChars) : void 0;
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
function isObject2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function branches(value) {
  return Array.isArray(value) ? value.filter(isObject2) : [];
}
function objectShape(schema) {
  const properties = isObject2(schema.properties) ? { ...schema.properties } : {};
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
  if (!isObject2(schema) || !describesObject(schema.type)) return { type: "object", properties: {} };
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
    if (!isObject2(tool)) {
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
function fitToolListResult(result, profile, log) {
  if (!profile || !isObject2(result) || !Array.isArray(result.tools)) return result;
  return { ...result, tools: fitToolList(result.tools, profile, log) };
}

// server/connector-proxy.ts
var UPSTREAM = process.env.OMB_CONNECTOR_UPSTREAM_URL ?? "";
var HARNESS = process.env.OMB_HARNESS_URL ?? "http://127.0.0.1:8799";
var BOT_ID = process.env.OMB_BOT_ID ?? "";
var THREAD_ID = process.env.OMB_THREAD_ID ?? "";
var TOKEN = process.env.OMB_CONNECTOR_TOKEN ?? process.env.OMB_COMMS_TOKEN ?? "";
var ALLOWED_TOOLS = parseConnectorAllowedToolsEnv(process.env[CONNECTOR_ALLOWED_TOOLS_ENV]);
var SERVICE_SLUGS = parseConnectorServiceSlugsEnv(process.env[CONNECTOR_SERVICE_SLUGS_ENV]);
var SCHEMA_PROFILE = toolSchemaProfileFromEnv(process.env);
var MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
var INITIALIZE_RELAY_TIMEOUT_MS = 1e3;
var RELAY_TIMEOUT_MS = 10 * 6e4;
var TOOLS_LIST_RETRY_MS = 500;
function parsedHeaders() {
  try {
    const value = JSON.parse(process.env.OMB_CONNECTOR_UPSTREAM_HEADERS ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry) => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}
var upstreamHeaders = parsedHeaders();
var upstreamSessionId = "";
var send = (message) => process.stdout.write(`${JSON.stringify(message)}
`);
function textResult(id, text, isError = false) {
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], ...isError ? { isError: true } : {} } };
}
function jsonRpcError(id, message) {
  return { jsonrpc: "2.0", id, error: { code: -32e3, message } };
}
function initializeResult(id, protocolVersion) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: typeof protocolVersion === "string" && protocolVersion ? protocolVersion : "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "openmausbot-connectors", version: "1" }
    }
  };
}
async function readBounded(response) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) throw new Error("connector response exceeded 20 MB");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("connector response exceeded 20 MB");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
function parseUpstream(text, id) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const frames = trimmed.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter((line) => line && line !== "[DONE]").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  return frames.findLast((frame) => frame.id === id) ?? frames.at(-1) ?? null;
}
async function relay(message, timeoutMs = RELAY_TIMEOUT_MS) {
  if (!UPSTREAM) throw new Error("connected apps are unavailable");
  const response = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...upstreamHeaders,
      ...upstreamSessionId ? { "mcp-session-id": upstreamSessionId } : {}
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const nextSession = response.headers.get("mcp-session-id");
  if (nextSession) upstreamSessionId = nextSession;
  if (!response.ok) throw new Error(`connector service returned HTTP ${response.status}`);
  return parseUpstream(await readBounded(response), message.id);
}
var BAD_AUTH_CONFIG_ID = "SpokyBot showed no card: auth_config_id must be a Composio auth config id (ac_ and then letters or digits), copied from Auth Configs in the person's Composio project. Leave it out to use their newest enabled config.";
function requestedAuthConfig(row) {
  return row.auth_config_id ?? row.auth_config_override;
}
function topLevelAuthConfig(args, slug, toolkitCount) {
  const value = requestedAuthConfig(args);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).find(([key]) => key.trim().toLowerCase() === slug)?.[1];
  }
  return value !== void 0 && toolkitCount !== 1 ? null : value;
}
function connectorAdds(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { requests: [], badAuthConfig: false };
  const toolkits = args.toolkits;
  if (!Array.isArray(toolkits)) return { requests: [], badAuthConfig: false };
  const seen = /* @__PURE__ */ new Set();
  const requests = [];
  for (const item of toolkits) {
    if (typeof item === "string") {
      const slug2 = item.trim().toLowerCase();
      const key2 = JSON.stringify([slug2, ""]);
      if (!seen.has(key2)) {
        seen.add(key2);
        requests.push({ slug: slug2 });
      }
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item;
    const action = String(row.action ?? "add").toLowerCase();
    if (!["add", "connect", "initiate"].includes(action)) continue;
    const slug = typeof row.toolkit === "string" ? row.toolkit : row.name;
    if (typeof slug !== "string") continue;
    const normalized = slug.trim().toLowerCase();
    const alias = (typeof row.alias === "string" ? row.alias : typeof row.account === "string" ? row.account : "").trim();
    const key = JSON.stringify([normalized, alias.toLowerCase()]);
    if (seen.has(key)) continue;
    seen.add(key);
    const authConfig = requestedAuthConfig(row);
    requests.push({ slug: normalized, ...alias ? { alias } : {}, ...authConfig !== void 0 ? { authConfig } : {} });
  }
  let badAuthConfig = false;
  const checked = requests.map(({ authConfig, ...request }) => {
    const value = authConfig ?? topLevelAuthConfig(args, request.slug, requests.length);
    if (value === void 0) return request;
    if (typeof value !== "string" || !AUTH_CONFIG_ID.test(value.trim())) {
      badAuthConfig = true;
      return request;
    }
    return { ...request, authConfigId: value.trim() };
  });
  return { requests: checked, badAuthConfig };
}
async function showConnectorCards(items) {
  const response = await fetch(`${HARNESS}/api/internal/connectors/request`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ botId: BOT_ID, threadId: THREAD_ID, items, resumeKey: randomUUID() }),
    signal: AbortSignal.timeout(3e4)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(String(body.error ?? `could not show connection card (HTTP ${response.status})`));
  }
}
function fittedList(frame) {
  if (!SCHEMA_PROFILE || !("result" in frame)) return frame;
  return { ...frame, result: fitToolListResult(frame.result, SCHEMA_PROFILE, (line) => process.stderr.write(`connector-proxy: ${line}
`)) };
}
async function handle(message) {
  const id = message.id;
  const method = String(message.method ?? "");
  if (method === "notifications/initialized" || method === "initialized") {
    if (UPSTREAM) void relay(message).catch(() => {
    });
    return;
  }
  if (method === "initialize") {
    if (UPSTREAM) {
      try {
        await relay(message, INITIALIZE_RELAY_TIMEOUT_MS);
      } catch {
      }
    }
    if (id !== void 0) {
      const params = message.params ?? {};
      send(initializeResult(id, params.protocolVersion));
    }
    return;
  }
  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = String(params.name ?? "");
    const { requests, badAuthConfig } = /MANAGE_CONNECTIONS$/i.test(name) ? connectorAdds(params.arguments) : { requests: [], badAuthConfig: false };
    if (badAuthConfig) {
      send(textResult(id, BAD_AUTH_CONFIG_ID, true));
      return;
    }
    if (requests.length) {
      await showConnectorCards(requests);
      const labels = requests.map((r) => r.alias ? `${r.slug} (${r.alias})` : r.slug).join(", ");
      send(textResult(
        id,
        `SpokyBot showed the user a secure connection card for ${labels}. End this turn now. The app will continue the task automatically after the connection finishes.`
      ));
      return;
    }
    if (/WAIT_FOR_CONNECTIONS$/i.test(name)) {
      send(textResult(id, "SpokyBot is handling connection completion and will continue the task automatically."));
      return;
    }
  }
  try {
    const response = method === "tools/list" ? await relay(message).catch(() => delay(TOOLS_LIST_RETRY_MS).then(() => relay(message))) : await relay(message);
    if (response && id !== void 0) {
      send(method === "tools/list" ? fittedList(ALLOWED_TOOLS ? filterToolsListFrame(response, ALLOWED_TOOLS, SERVICE_SLUGS) : response) : method === "tools/call" ? withSignedOutHint(message, response, SERVICE_SLUGS) : response);
    }
  } catch (error) {
    if (id === void 0) return;
    const messageText = error instanceof Error ? error.message : String(error);
    if (method === "tools/call") send(textResult(id, messageText, true));
    else send(jsonRpcError(id, messageText));
  }
}
var input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  void handle(message).catch((error) => {
    if (message.id === void 0) return;
    const method = String(message.method ?? "");
    const messageText = error instanceof Error ? error.message : String(error);
    if (method === "tools/call") send(textResult(message.id, messageText, true));
    else send(jsonRpcError(message.id, messageText));
  });
});
input.on("close", () => process.exit(0));
