import { createRequire as __ombCreateRequire } from "node:module";
const require = __ombCreateRequire(import.meta.url);

// server/permission-proxy.ts
import { connect } from "node:net";
import { randomUUID } from "node:crypto";

// shared/ask-question.ts
var MAX_QUESTIONS = 6;
var MAX_OPTIONS = 12;
var MAX_QUESTION_TEXT = 8e3;
var MAX_LABEL = 120;
var MAX_DESCRIPTION = 400;
var MAX_CUSTOM_ANSWER = 2e3;
function text(value, limit) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit).trim() : void 0;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseOption(value) {
  if (typeof value === "string") {
    const label2 = text(value, MAX_LABEL);
    return label2 ? { label: label2 } : null;
  }
  if (!isRecord(value)) return null;
  const label = text(value.label, MAX_LABEL);
  if (!label) return null;
  const description = text(value.description, MAX_DESCRIPTION);
  return description ? { label, description } : { label };
}
function parseQuestion(value) {
  if (!isRecord(value)) return null;
  const question = text(value.question, MAX_QUESTION_TEXT);
  if (!question) return null;
  const options = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of Array.isArray(value.options) ? value.options : []) {
    const option = parseOption(raw);
    if (!option || seen.has(option.label)) continue;
    seen.add(option.label);
    options.push(option);
    if (options.length === MAX_OPTIONS) break;
  }
  const header = text(value.header, MAX_LABEL);
  return {
    question,
    ...header ? { header } : {},
    ...value.multiSelect === true ? { multiSelect: true } : {},
    options,
    // only meaningful beside options: with none, free text is the only answer
    ...value.custom === false && options.length ? { custom: false } : {}
  };
}
function parseAskQuestions(input) {
  if (!isRecord(input) || !Array.isArray(input.questions)) return null;
  const questions = [];
  for (const raw of input.questions) {
    const question = parseQuestion(raw);
    if (!question) continue;
    questions.push(question);
    if (questions.length === MAX_QUESTIONS) break;
  }
  return questions.length ? questions : null;
}
var ANSWER_PREAMBLE = "The user answered your questions.";
var JSON_ANSWERS_PREFIX = `${ANSWER_PREAMBLE}

Answers (JSON):
`;
var MAX_ANSWER_ECHO = ANSWER_PREAMBLE.length + MAX_QUESTIONS * ("\n\nQ: \nA: ".length + MAX_QUESTION_TEXT + MAX_OPTIONS * (MAX_LABEL + ", ".length) + MAX_CUSTOM_ANSWER);
function questionAnswersByQuestion(message, questions) {
  return questionAnswersById(message, questions.map((question) => ({ id: question.question, question })));
}
function questionAnswersById(message, questions) {
  const answers = /* @__PURE__ */ Object.create(null);
  const idByText = /* @__PURE__ */ new Map();
  const ambiguous = /* @__PURE__ */ new Set();
  for (const { id, question } of questions) {
    if (idByText.has(question.question)) {
      ambiguous.add(question.question);
      continue;
    }
    idByText.set(question.question, id);
  }
  if (message.startsWith(JSON_ANSWERS_PREFIX)) {
    let pairs;
    try {
      pairs = JSON.parse(message.slice(JSON_ANSWERS_PREFIX.length));
    } catch {
      return {};
    }
    if (!Array.isArray(pairs) || !pairs.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((value) => typeof value === "string"))) return {};
    for (const [asked, answer] of pairs) {
      const id = idByText.get(asked);
      if (id && !ambiguous.has(asked) && answer.trim()) answers[id] = answer;
    }
    return answers;
  }
  const blocks = message.matchAll(/(?:^|\n\n)Q: ([\s\S]+?)\nA: ([\s\S]*?)(?=\n\nQ: |$)/g);
  let sawBlock = false;
  for (const match of blocks) {
    sawBlock = true;
    const asked = match[1].trim();
    if (ambiguous.has(asked)) continue;
    const id = idByText.get(asked);
    const answer = match[2].trim();
    if (id && answer) answers[id] = answer;
  }
  if (Object.keys(answers).length) return answers;
  if (sawBlock) return {};
  const only = questions.length === 1 ? questions[0] : void 0;
  const flat = message.trim();
  return only && flat ? { [only.id]: flat } : {};
}

// shared/tool-scope.ts
var SERVER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
var CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;
var MAX_SELECTORS = 256;
var MAX_SELECTOR_LENGTH = 1024;
function validName(name) {
  return typeof name === "string" && name.trim().length > 0 && name.length <= MAX_SELECTOR_LENGTH && !CONTROL_CHARACTER.test(name) && !name.includes("*");
}
function selectorIdentity(selector) {
  if (selector.length > MAX_SELECTOR_LENGTH || CONTROL_CHARACTER.test(selector)) return;
  if (selector.startsWith("native:")) {
    const name = selector.slice(7);
    if (name === "*" || validName(name)) return { kind: "native", name };
  } else if (selector.startsWith("mcp:")) {
    const separator = selector.indexOf(":", 4);
    if (separator < 0) return;
    const server = selector.slice(4, separator);
    const name = selector.slice(separator + 1);
    if (SERVER_NAME.test(server) && (name === "*" || validName(name))) {
      return { kind: "mcp", server, name };
    }
  }
}
function parseToolScope(value) {
  if (value === void 0) return { ok: true, scope: void 0 };
  const invalid = { ok: false, error: "Tool selection must contain only valid allow and deny lists." };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid;
  const scope = {};
  for (const key of Reflect.ownKeys(value)) {
    if (key !== "allow" && key !== "deny") return invalid;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return invalid;
    const list = descriptor.value;
    if (!Array.isArray(list) || list.length > MAX_SELECTORS) return invalid;
    if (!Array.from(list).every((entry) => typeof entry === "string" && selectorIdentity(entry))) return invalid;
    scope[key] = [...new Set(list)];
  }
  return { ok: true, scope };
}
function matches(selector, tool) {
  const selected = selectorIdentity(selector);
  return selected?.kind === tool.kind && (selected.kind !== "mcp" || tool.kind === "mcp" && selected.server === tool.server) && (selected.name === "*" || selected.name === tool.name);
}
function permits(scope, tool) {
  if (!validName(tool.name) || tool.kind === "mcp" && !SERVER_NAME.test(tool.server)) return false;
  return (scope?.allow === void 0 || scope.allow.some((selector) => matches(selector, tool))) && !scope?.deny?.some((selector) => matches(selector, tool));
}
function allowsTool(scope, tool) {
  const parsed = parseToolScope(scope);
  return parsed.ok && permits(parsed.scope, tool);
}

// server/permission-proxy.ts
var selection = parseToolScope(process.env.OMB_PERMISSION_TOOL_SCOPE === void 0 ? void 0 : (() => {
  try {
    return JSON.parse(process.env.OMB_PERMISSION_TOOL_SCOPE);
  } catch {
    return null;
  }
})());
if (!selection.ok) throw new Error(selection.error);
var allowQuestion = allowsTool(selection.scope, { kind: "mcp", server: "ogb", name: "ask_user" });
var socketPath = process.argv[2] ?? "";
var waiting = /* @__PURE__ */ new Map();
var conn = connect(socketPath);
conn.setEncoding("utf8");
var dead = () => {
  for (const resolve of waiting.values()) {
    resolve({ behavior: "deny", message: "SpokyBot: permission broker unavailable \u2014 skip this action" });
  }
  waiting.clear();
};
conn.on("error", dead);
conn.on("close", dead);
var connBuf = "";
conn.on("data", (chunk) => {
  connBuf += chunk;
  let nl;
  while ((nl = connBuf.indexOf("\n")) !== -1) {
    const line = connBuf.slice(0, nl);
    connBuf = connBuf.slice(nl + 1);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.t === "answer") {
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  }
});
var send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
function askBroker(ask) {
  return new Promise((resolve) => {
    waiting.set(String(ask.id), resolve);
    if (conn.destroyed) return dead();
    try {
      conn.write(JSON.stringify(ask) + "\n");
    } catch {
      dead();
    }
  });
}
function multiSelectQuestion(args) {
  if (args.multiSelect !== true) return null;
  const options = Array.isArray(args.choices) ? args.choices : [];
  return parseAskQuestions({ questions: [{ question: args.question, multiSelect: true, options }] });
}
var ASK_USER_QUESTION = "AskUserQuestion";
var asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
async function answerNativeQuestions(input) {
  const questions = parseAskQuestions(input);
  if (!questions?.length) {
    return JSON.stringify({
      behavior: "deny",
      message: "SpokyBot: this AskUserQuestion call had no answerable question (each one needs question text), so nobody was shown it. Ask again with a well-formed call, or continue without it."
    });
  }
  const answer = await askBroker({
    t: "ask",
    id: randomUUID(),
    kind: "question",
    tool: ASK_USER_QUESTION,
    input: { questions }
  });
  if (answer.behavior === "deny") {
    return JSON.stringify({ behavior: "deny", message: answer.message || "Denied from SpokyBot" });
  }
  const answers = answer.source === "user" && typeof answer.message === "string" ? questionAnswersByQuestion(answer.message, questions) : {};
  return JSON.stringify({ behavior: "allow", updatedInput: { ...asRecord(input), answers } });
}
var TOOLS = [
  {
    name: "approve",
    description: "Ask the SpokyBot user whether a tool use is allowed",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        tool_use_id: { type: "string" }
      },
      required: ["tool_name", "input"]
    }
  },
  {
    name: "ask_user",
    description: "Ask the human who owns this bot a question and wait for their answer. Use whenever you need a decision, a preference, missing information, or sign-off before doing something consequential \u2014 do not guess on things the owner would want to decide. Returns their answer as text.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question, with enough context to answer at a glance" },
        choices: {
          type: "array",
          items: { type: "string" },
          description: "Optional 2-5 suggested answers, shown as one-tap buttons"
        },
        multiSelect: {
          type: "boolean",
          description: "Set true when the person may pick more than one of the choices. Their picks come back joined with commas."
        }
      },
      required: ["question"]
    }
  }
];
async function handle(msg) {
  if (msg.method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openmausbot-permissions", version: "1" }
      }
    });
  }
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS.filter((tool) => tool.name === "approve" || allowQuestion) } });
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments ?? {};
    const reply = (text3) => send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: text3 }] } });
    if (name === "ask_user" && !allowQuestion) return reply("SpokyBot: this question tool is excluded by the bot's tool selection.");
    if (name === "approve" && args.tool_name === ASK_USER_QUESTION) {
      return reply(await answerNativeQuestions(args.input));
    }
    const askId = randomUUID();
    const isQuestion = name === "ask_user";
    const picksSeveral = isQuestion ? multiSelectQuestion(args) : null;
    const suggestions = Array.isArray(args.permission_suggestions) ? args.permission_suggestions : Array.isArray(args.suggestions) ? args.suggestions : null;
    const answer = await askBroker(
      isQuestion ? { t: "ask", id: askId, kind: "question", tool: "ask_user", input: { question: args.question, choices: args.choices, ...picksSeveral ? { questions: picksSeveral } : {} } } : { t: "ask", id: askId, tool: args.tool_name, input: args.input }
    );
    let text2 = answer.message || "No answer was given \u2014 use your best judgment.";
    if (picksSeveral && answer.source === "user" && typeof answer.message === "string") {
      text2 = questionAnswersByQuestion(answer.message, picksSeveral)[picksSeveral[0].question] ?? text2;
    }
    if (!isQuestion) {
      if (answer.behavior === "allow") {
        const result = { behavior: "allow", updatedInput: args.input ?? {} };
        if (answer.always && suggestions) result.updatedPermissions = suggestions;
        text2 = JSON.stringify(result);
      } else {
        text2 = JSON.stringify({ behavior: "deny", message: answer.message || "Denied from SpokyBot" });
      }
    }
    return reply(text2);
  }
  if (String(msg.method ?? "").startsWith("notifications/")) return;
  if (msg.id != null) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
}
var inBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inBuf += chunk;
  let nl;
  while ((nl = inBuf.indexOf("\n")) !== -1) {
    const line = inBuf.slice(0, nl);
    inBuf = inBuf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
    }
  }
});
process.stdin.on("end", () => process.exit(0));
