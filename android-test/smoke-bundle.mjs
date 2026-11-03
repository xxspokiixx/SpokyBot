// Windows-side e2e proof for the on-device bundle: boots android-test's staged
// assets/omb exactly as the app boots it on the phone — same entry, same env
// contract (no OMB_DESKTOP_PARENT), same two-word `node <script>` cli seed for
// the fixture engine — then walks the flow the Android shell replays:
// health → env descriptor → pairing mint → pair exchange → cookie session →
// static UI → first-run starter bot → one fixture engine turn.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = join(import.meta.dirname, "..");
const OMB = join(ROOT, "android-test", "app", "src", "main", "assets", "omb");
const PORT = await freePortPair(18980, 18999);

let failed = 0;
let existingCookie = null;
const BASE = `http://127.0.0.1:${PORT}`;

let child = null;
try {
  await main();
} finally {
  if (child) child.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);

async function main() {
  assertBootAssets();
  const proc = bootServer();
  child = proc.child;

  step("health", await pollHealth(30_000));
  step("environment descriptor", await expectEnvironment(30_000));
  const pairOutcome = await pairSession();
  step("cookie session", pairOutcome !== null);
  if (!pairOutcome) return;
  note(pairOutcome);
  step("static UI", await expectStaticUi());

  const bot = await starterBot();
  step("first-run starter bot on the fixture engine", Boolean(bot));
  if (!bot) return;
  await instancesReport();
  step("mobile data gate refuses the native engine", await expectsDataEngineRefusal(bot));

  step("fixture engine reply within 60 s", await turnAndExpectReply(bot, 60_000));
}

/** resolveCliSpawn tokenizes a "bin script" cli on spaces, so the bin head must
 * never contain them. The phone's paths are space-free; Windows' default
 * node.exe sits in "Program Files": use the short 8.3 name when it exists,
 * otherwise a plain copy beside the head. */
function nodePathWithoutSpaces(preferred) {
  if (!preferred.includes(" ")) return preferred;
  let short = "";
  try {
    short = execFileSync("cmd", ["/d", "/s", "/q", "/c", "for", "%i", "in", `(\"${preferred}\")`, "do", "@echo", "%~si"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {}
  if (short && !short.includes(" ") && existsSync(short)) return short;
  const copy = join(tmpdirRoot(), "node-copy.exe");
  try {
    if (!existsSync(copy)) copyFileSync(preferred, copy);
    return copy;
  } catch (error) {
    throw new Error(`no space-free node path: ${error.message}`);
  }
}

function assertBootAssets() {
  for (const required of ["VERSION", join("server", "index.js"), join("ui", "index.html"), join("engine", "fake-claude-cli.ts")]) {
    if (!existsSync(join(OMB, required))) fail(`missing staged asset omb/${required} — run android-test/prepare-android-assets.mjs`);
  }
  note(`assets omb VERSION ${readFileSync(join(OMB, "VERSION"), "utf8").trim()}`);
}

function bootServer() {
  const home = join(tmpdirRoot(), "home");
  const data = join(tmpdirRoot(), "data");
  mkdirSync(home, { recursive: true });
  mkdirSync(data, { recursive: true });
  mkdirSync(join(tmpdirRoot(), "tmp"), { recursive: true });
  const engine = join(OMB, "engine", "fake-claude-cli.ts");
  if (engine.includes(" ")) throw new Error(`engine path contains spaces: ${engine}`);
  const nodePath = nodePathWithoutSpaces(process.execPath);
  note(`cli head ${nodePath}`);
  const cli = `${nodePath} ${engine}`;
  writeFileSync(join(data, "config.json"), JSON.stringify({
    features: { browser: false, skillsLibrary: true },
    instances: {
      claude: { driver: "claudeAgent", displayName: "MausBot (fixture)", config: { cli } },
    },
  }, null, 2));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("OMB_") || key.startsWith("FAKE_CLAUDE_") || key.startsWith("FAKE_CODEX_")) delete env[key];
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: join(tmpdirRoot(), "tmp"),
    TMP: join(tmpdirRoot(), "tmp"),
    NODE_ENV: "production",
    LANG: "C.UTF-8",
    // Android behaves as platform"android"; OMB_MOBILE=1 is the documented
    // equivalent, letting Windows witness what the phone's data routes do.
    OMB_MOBILE: "1",
    OMB_PORT: String(PORT),
    OMB_STATIC_DIR: join(OMB, "ui"),
    OMB_DATA_DIR: data,
  });
  const skills = join(OMB, "skills");
  if (existsSync(skills)) env.OMB_SKILLS_DIR = skills;

  const logPath = join(tmpdirRoot(), "server.log");
  const child = spawn(process.execPath, [join(OMB, "server", "index.js")], {
    cwd: join(OMB, "server"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffered = "";
  const append = (text) => {
    buffered = (buffered + text).slice(-16_000);
    try { writeFileSync(logPath, buffered); } catch {}
  };
  child.stdout.setEncoding("utf8").on("data", append);
  child.stderr.setEncoding("utf8").on("data", append);
  child.on("exit", (code) => { child.exited = { code }; });
  note(`server on ${PORT}, log ${logPath}`);
  return { child, logPath };
}

async function pollHealth(deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const { res } = await request("GET", "/api/health", { timeoutMs: 1500 });
    if (res?.status === 200) {
      note(`health: ${res.body.slice(0, 160)}`);
      return true;
    }
    if (child.exited) {
      fail(`server exited code ${child.exited.code}:\n${tailLog()}`);
      return false;
    }
    await sleep(400);
  }
  console.error(tailLog());
  return false;
}

async function expectEnvironment(deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const { res } = await request("GET", "/.well-known/openmausbot/environment", { timeoutMs: 2500 });
    if (res?.status === 200 && res.body.includes("environmentId")) {
      note(`environment: ${res.body.slice(0, 220)}`);
      return true;
    }
    await sleep(300);
  }
  fail("environment descriptor never answered 200 with environmentId");
  return false;
}

/** The flow NodeHostService.pairWebView runs: mint (loopback owner), exchange
 * with a backup code, then validate the Set-Cookie session. */
async function pairSession() {
  const mint = await jsonRequest("POST", "/api/auth/pairing", { label: "android-smoke" });
  if (mint.res?.status !== 200) {
    fail(`pairing mint failed: ${mint.res?.status} ${mint.body?.slice(0, 300)}`);
    return null;
  }
  const code = mint.json?.code;
  if (!code) {
    fail(`pairing body had no code: ${mint.body.slice(0, 300)}`);
    return null;
  }
  note(`pairing code ${code}`);
  const pair = await jsonRequest("POST", "/api/auth/pair", {
    code: code.toUpperCase().replaceAll("-", ""),
    label: "Android WebView",
    cookie: true,
    attemptId: randomUUID(),
  });
  if (pair.res?.status !== 200) {
    fail(`pair failed: ${pair.res?.status} ${pair.body?.slice(0, 300)}`);
    return null;
  }
  const cookies = pair.setCookie.map((line) => line.split(";")[0]);
  if (!cookies.length) {
    fail(`pair gave no set-cookie: ${pair.body.slice(0, 300)}`);
    return null;
  }
  existingCookie = cookies.join("; ");
  note(`pair cookie: ${existingCookie.slice(0, 80)}…`);
  const check = await request("GET", "/api/auth/session", { timeoutMs: 5000 });
  if (check.res?.status !== 200 || !check.res.body.includes("\"kind\"")) {
    fail(`/api/auth/session not accepted: ${check.res?.status} ${check.res?.body?.slice(0, 200)}`);
    return null;
  }
  const scopes = pair.json?.session?.scopes?.join("+") ?? "?";
  return `session used for the rest of the run (scopes ${scopes})`;
}

async function expectStaticUi() {
  const { res, body } = await request("GET", "/", { timeoutMs: 5000 });
  const ok = res?.status === 200 && body.includes("<div id=\"root\">");
  if (ok) note(`UI served, ${body.length} bytes`);
  else fail(`static UI failed: ${res?.status} ${body.slice(0, 200)}`);
  return ok;
}

/** The first-run starter bot: the server creates it once the engine's startup
 * catalog is in, so the read may lag a probe by a few seconds. */
async function starterBot() {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const { res, body } = await request("GET", "/api/bots?messages=0", { timeoutMs: 5000 });
    if (res?.status === 200) {
      const bots = json(body)?.bots;
      if (Array.isArray(bots)) {
        const bot = bots[0];
        if (bots.length !== 1) {
          fail(`expected exactly one first-run starter bot, got ${bots.length}`);
          return null;
        }
        if (bot?.modelSelection?.instanceId) {
          if (bot.modelSelection.instanceId !== "claude") {
            fail(`starter bot is not on the claude instance: ${JSON.stringify(bot.modelSelection)}`);
            return null;
          }
          note(`starter bot "${bot.name}" (${bot.id}) thread ${bot.threadId}`);
          return { id: bot.id, threadId: bot.threadId };
        }
      }
    }
    await sleep(500);
  }
  fail("starter bot never got an engine selection within 15 s");
  return null;
}

/** The embedded build deliberately ships no duckdb/resvg: the data panel must
 * say so loudly instead of erroring on a phone-only platform. */
async function expectsDataEngineRefusal(bot) {
  const { res, body } = await request("GET", `/api/bots/${bot.id}/data`, { timeoutMs: 8000 });
  if (res?.status !== 503) {
    fail(`data route answered ${res?.status}: ${body.slice(0, 200)}`);
    return false;
  }
  const code = json(body)?.error?.code;
  if (code !== "engine_unavailable") {
    fail(`data route 503 but code ${JSON.stringify(code)}`);
    return false;
  }
  note(json(body)?.error?.message);
  return true;
}

async function instancesReport() {
  const { res, body } = await request("GET", "/api/instances", { timeoutMs: 10_000 });
  const payload = res?.status === 200 ? json(body) : null;
  const claude = Array.isArray(payload?.instances) ? payload.instances.find((one) => one.instanceId === "claude") : null;
  if (claude) note(`claude instance: ${claude.snapshot?.state ?? "?"}${claude.snapshot?.reason ? ` (${JSON.stringify(claude.snapshot.reason).slice(0, 120)})` : ""}`);
  else note(`GET /api/instances -> ${res?.status} ${body.slice(0, 160)}`);
}

async function turnAndExpectReply(bot, deadlineMs) {
  const sendId = randomUUID();
  const before = await apiBots();
  const hadBotText = countBotTurns(before);
  const send = await jsonRequest("POST", `/api/bots/${bot.id}/messages`, {
    text: "Hello from the Android smoke test",
    threadId: bot.threadId,
    sendId,
  });
  if (send.res?.status !== 200 && send.res?.status !== 202) {
    fail(`send failed: ${send.res?.status} ${send.body?.slice(0, 300)}`);
    return false;
  }
  note(`send accepted (thread ${send.json?.threadId ?? "?"})`);
  const end = Date.now() + deadlineMs;
  let bots = before;
  while (Date.now() < end) {
    await sleep(800);
    if (child.exited) {
      fail(`server exited code ${child.exited.code} during turn:\n${tailLog()}`);
      return false;
    }
    bots = await apiBots();
    if (countBotTurns(bots) > hadBotText) {
      note("bot reply appeared");
      return true;
    }
  }
  console.error("last messages:\n" + lastMessages(bots));
  fail(`no bot reply within ${deadlineMs / 1000}s`);
  return false;
}

function countBotTurns(payload) {
  const bots = json(payload ?? "{}")?.bots ?? [];
  const bot = bots[0];
  return (bot?.messages ?? []).filter((m) => m.role === "bot" && (m.kind === "text" || m.kind === "digest")).length;
}

function lastMessages(payload) {
  const bot = json(payload ?? "{}")?.bots?.[0];
  return JSON.stringify((bot?.messages ?? []).slice(-6), null, 1).slice(0, 3000);
}

async function apiBots() {
  const { body } = await request("GET", "/api/bots?messages=1", { timeoutMs: 5000 });
  return body;
}

function tmpdirRoot() {
  if (tmpdirRoot.value) return tmpdirRoot.value;
  tmpdirRoot.value = mkdtempSync(join(tmpdir(), "omb-android-smoke-"));
  return tmpdirRoot.value;
}

function json(text) {
  return parseJsonOrNull(text);
}

async function request(method, path, { timeoutMs = 5000, body, headers = {} } = {}) {
  try {
    const allHeaders = { ...headers };
    if (existingCookie) allHeaders.Cookie = existingCookie;
    if (body !== undefined) allHeaders["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: allHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    const text = await res.text();
    const setCookie = res.headers.getSetCookie?.() ?? [];
    return { res: { status: res.status, body: text }, json: parseJsonOrNull(text), body: text, setCookie };
  } catch (error) {
    if (request.debugOnce !== true) {
      request.debugOnce = true;
      console.error(`      first request error: ${error.cause?.code ?? error.cause?.message ?? error.message}`);
    }
    return { res: null, json: null, body: "", setCookie: [] };
  }
}

function jsonRequest(method, path, body) {
  return request(method, path, { body, timeoutMs: 10_000 });
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function freePortPair(first, last) {
  for (let port = first; port < last; port++) {
    if (await portFree(port) && await portFree(port + 1)) return port;
  }
  fail(`no free port pair in ${first}-${last + 1}`);
  return first;
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function step(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed = 1;
}

function note(text) {
  console.log(`      ${text}`);
}

function fail(message) {
  failed = 1;
  console.error(`FAIL  ${message}`);
}

function tailLog() {
  const path = join(tmpdirRoot(), "server.log");
  if (!existsSync(path)) return "(no server log)";
  const text = readFileSync(path, "utf8");
  return (text.length < 4000 ? text : text.slice(-4000)).trim();
}

const cleanup = () => {
  try {
    rmSync(tmpdirRoot.value, { recursive: true, force: true });
  } catch {}
};
process.on("exit", () => {
  if (!failed) cleanup();
});
