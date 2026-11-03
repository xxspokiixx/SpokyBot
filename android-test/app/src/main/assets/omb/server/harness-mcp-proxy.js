import { createRequire as __ombCreateRequire } from "node:module";
const require = __ombCreateRequire(import.meta.url);

// server/harness-mcp-proxy.ts
import { pathToFileURL } from "node:url";

// server/data/instructions.ts
var DATA_INSTRUCTIONS = `The Data tools run DuckDB SQL on this bot's own database; results appear on the Data tab beside the chat. Dialect: double quotes name identifiers ("Order Date"), single quotes make strings ('2024-01-01'); identifiers are case-insensitive. GROUP BY ALL groups by every non-aggregated column; QUALIFY filters window results; SELECT * EXCLUDE (col) and COLUMNS('re.*') pick columns; PIVOT/UNPIVOT reshape. Dates: date_trunc('month', d), time_bucket(INTERVAL '1 week', ts), strftime(d, '%Y-%m'), d::DATE, try_cast(x AS DOUBLE), today(), now(). Strings and lists are 1-based (substr, list[1]); sum() of an empty group is NULL; -2^2 is 4; x IN (0, NULL) is NULL when no match. Read files directly: read_csv('a.csv'), read_parquet('dir/*.parquet'), read_json_auto('x.ndjson'), read_xlsx('b.xlsx', sheet='S'); SUMMARIZE tbl, DESCRIBE tbl and SHOW TABLES describe what is loaded. Run data_describe before writing SQL against a table; aggregate or filter in SQL before charting; one statement per call. To present your answer, call data_show: it publishes one result in Data and a compact Open in Data link in this conversation. Earlier results remain in History. To discuss or edit a saved query, call data_describe with its id, or with no arguments for the latest saved result and the result/table catalog. Latest does not identify the person's selected result; use the supplied id or clarify when ambiguous. Update that result with data_show id and sql; omitted kind and chart settings stay unchanged. The person's SQL is visible below the result. Use these tools, not computer/UI automation, to read or change SQL. Never guess fields listed as omitted in a bounded result. You can clean data with Python using your existing tools, save CSV/Parquet/JSON, then data_load and data_show; write no dashboard or chart JavaScript unless the person asks for a dashboard page.`;

// server/highlevel/instructions.ts
var HIGHLEVEL_INSTRUCTIONS = "The HighLevel tools read and update the connected HighLevel (or Growably, or another HighLevel-based) CRM location: contacts, tags, notes, tasks, pipelines and opportunities, conversations (read only), calendars and events (read only), and the location's custom fields. Call HIGHLEVEL_GET_LOCATION once to learn the location's name, timezone and custom field names before writing custom fields. Find a contact with HIGHLEVEL_SEARCH_CONTACTS before creating one; pass ids from results, never guessed ones. Dates are ISO 8601 strings. Results are trimmed to the fields a person would care about, never raw API dumps. These tools never send SMS, email, WhatsApp or any other message, and never start campaigns or workflows: do not try to message anyone through the CRM, and do not work around it with other tools. Every write is recorded in the bot's activity with the record id and the fields changed. When a tool answers that HighLevel is signed out, ask the person to reconnect it under Connected apps and end the turn.";

// server/harness-budget.ts
var HARNESS_PROXY_TIMEOUT_MS = 13e4;

// server/harness-mcp-request.ts
var MAX_INPUT_BYTES = 1048576;
var MAX_OUTPUT_BYTES = 16777216;
var NAMES = { browser: "Browser", computer: "Cloud computer", data: "Data", highlevel: "HighLevel" };
var INSTRUCTIONS = { data: DATA_INSTRUCTIONS, highlevel: HIGHLEVEL_INSTRUCTIONS };
var RECOVERY = {
  browser: " This failure does not establish that all browsers are unavailable. Inspect available connections with select_computer if that tool is present. Keep the requested computer and account; do not bypass a permission refusal or human takeover, and do not repeat an uncertain action without checking its result.",
  computer: " Keep working on the assigned cloud computer only; do not bypass a person's control of it, and take a fresh screenshot before repeating an action whose result is uncertain.",
  data: " The tables already loaded are unchanged; check with data_describe or SHOW TABLES before repeating a load, and do not repeat a statement whose result is uncertain.",
  highlevel: " The CRM may or may not have taken the change; read the record back (HIGHLEVEL_GET_CONTACT, HIGHLEVEL_GET_OPPORTUNITY) before repeating a write, and never message anyone through the CRM."
};
function parseHarnessMcpKind(value) {
  return value === "browser" || value === "computer" || value === "data" || value === "highlevel" ? value : null;
}
function unansweredText(error, name) {
  const code = error?.cause?.code;
  const call = `this ${name.toLowerCase()} call`;
  if (code === "ECONNREFUSED") return `SpokyBot is restarting, so ${call} did not reach it and did not run. Wait a few seconds, then make it again.`;
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return `SpokyBot restarted while ${call} was running, so it may or may not have taken effect. Check its result before repeating it.`;
  if (error?.name === "TimeoutError") {
    return `SpokyBot did not answer ${call} within ${HARNESS_PROXY_TIMEOUT_MS / 1e3} seconds. It may still be running, or it may already have taken effect. Do not repeat it until its result is checked.`;
  }
  return error instanceof Error && !/fetch failed|abort|timeout|terminated/i.test(error.message) ? error.message : `${name} connection was interrupted. Do not repeat the action until its state is checked.`;
}
function failure(id, method, message, code = -32603) {
  return method === "tools/call" ? { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } } : { jsonrpc: "2.0", id, error: { code, message } };
}
async function boundedJson(response, name) {
  if (!response.body) throw new Error(`${name} server returned an empty response.`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OUTPUT_BYTES) throw new Error(`${name} response exceeded the size limit.`);
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {
    });
  }
}
async function harnessMcpRequest(frame, connection) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return failure(null, null, "Invalid request.", -32600);
  const message = frame;
  const id = message.id ?? null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || id !== null && typeof id !== "number" && typeof id !== "string") return failure(null, null, "Invalid request.", -32600);
  if (!Object.hasOwn(message, "id")) return void 0;
  const name = NAMES[connection.kind];
  if (message.method === "initialize") return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: `openmausbot-${connection.kind}`, version: "1" },
      ...INSTRUCTIONS[connection.kind] ? { instructions: INSTRUCTIONS[connection.kind] } : {}
    }
  };
  if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (message.method !== "tools/list" && message.method !== "tools/call") return failure(id, message.method, "Method not found.", -32601);
  try {
    const url = new URL(connection.url);
    if (!connection.token || url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`${name} connection is not configured. Start a new bot turn from SpokyBot.`);
    }
    const body = JSON.stringify({ method: message.method, params: message.params ?? {} });
    if (Buffer.byteLength(body) > MAX_INPUT_BYTES) throw new Error(`${name} request exceeded the size limit.`);
    const response = await fetch(new URL(`/api/internal/${connection.kind}/mcp`, url), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${connection.token}` },
      body,
      signal: AbortSignal.timeout(HARNESS_PROXY_TIMEOUT_MS)
    });
    const payload = await boundedJson(response, name);
    if (!response.ok || !payload || typeof payload !== "object" || !Object.hasOwn(payload, "result")) {
      throw new Error(typeof payload?.error === "string" ? payload.error.slice(0, 2e3) : `${name} server is unavailable. Start a new bot turn or try again.`);
    }
    return { jsonrpc: "2.0", id, result: payload.result };
  } catch (error) {
    return failure(id, message.method, unansweredText(error, name) + RECOVERY[connection.kind]);
  }
}

// server/harness-mcp-token.ts
function harnessMcpTokenEnv(kind) {
  return `OMB_MCP_TOKEN_${kind.toUpperCase()}`;
}

// server/harness-mcp-proxy.ts
var MAX_PENDING = 16;
function run(kind) {
  const connection = { url: process.env.OMB_HARNESS_URL ?? "", token: process.env[harnessMcpTokenEnv(kind)] ?? "", kind };
  let input = Buffer.alloc(0);
  let pending = 0;
  const output = (message) => {
    if (message === void 0) return;
    const line = `${JSON.stringify(message)}
`;
    if (Buffer.byteLength(line) > MAX_OUTPUT_BYTES || process.stdout.writableLength > MAX_OUTPUT_BYTES * 2) {
      process.stdin.destroy();
      process.exitCode = 1;
      return;
    }
    process.stdout.write(line);
  };
  process.stdout.on("error", () => {
    process.stdin.destroy();
    process.exitCode = 1;
  });
  process.stdin.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    let newline;
    while ((newline = input.indexOf(10)) !== -1) {
      if (newline > MAX_INPUT_BYTES) {
        process.stdin.destroy();
        process.exitCode = 1;
        return;
      }
      const line = input.subarray(0, newline).toString("utf8");
      input = input.subarray(newline + 1);
      if (!line.trim()) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        output(failure(null, null, "Parse error.", -32700));
        continue;
      }
      if (pending >= MAX_PENDING) {
        const request = frame;
        if (request && Object.hasOwn(request, "id")) output(failure(request.id ?? null, request.method, `Too many pending ${kind} requests.`));
        continue;
      }
      pending++;
      void harnessMcpRequest(frame, connection).then(output).finally(() => {
        pending--;
      });
    }
    if (input.length > MAX_INPUT_BYTES) {
      process.stdin.destroy();
      process.exitCode = 1;
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const kind = parseHarnessMcpKind(process.argv[2]);
  if (!kind) {
    process.stderr.write("usage: harness-mcp-proxy browser|computer|data|highlevel\n");
    process.exitCode = 2;
  } else run(kind);
}
export {
  harnessMcpRequest
};
