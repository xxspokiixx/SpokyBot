import { createRequire as __ombCreateRequire } from "node:module";
const require = __ombCreateRequire(import.meta.url);

// server/hooks/omb-hook.ts
import { readFileSync } from "node:fs";
var CONTEXT_EVENTS = /* @__PURE__ */ new Set(["SessionStart", "UserPromptSubmit"]);
var requestedBudget = Number(process.env.OMB_HOOK_TIMEOUT_MS);
var budgetMs = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.min(requestedBudget, 4e3) : 4e3;
var MAX_INPUT_BYTES = 1024 * 1024;
var url = process.env.OMB_HOOK_URL ?? "";
var tokenFile = process.env.OMB_HOOK_TOKEN_FILE ?? "";
var done = (out) => {
  if (out === void 0) process.exit(0);
  process.stdout.write(out, () => process.exit(0));
};
process.stdout.on("error", () => process.exit(0));
var fuse = setTimeout(() => done(), budgetMs);
fuse.unref();
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    let bytes = 0;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_INPUT_BYTES) return done();
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
async function main() {
  const raw = await readStdin();
  let payload;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return done();
    payload = parsed;
  } catch {
    return done();
  }
  const event = typeof payload.hook_event_name === "string" ? payload.hook_event_name : "";
  if (!event || !/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(url) || !tokenFile) return done();
  let token = "";
  try {
    token = readFileSync(tokenFile, "utf8").trim();
  } catch {
    return done();
  }
  if (!token) return done();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(200, budgetMs - 300));
  try {
    const response = await fetch(`${url}/api/internal/hook`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ event, payload }),
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) return done();
    const body = await response.json().catch(() => null);
    if (body && typeof body === "object" && body.hookSpecificOutput && typeof body.hookSpecificOutput === "object") {
      return done(JSON.stringify({ hookSpecificOutput: body.hookSpecificOutput }));
    }
    if (body && typeof body === "object" && typeof body.context === "string" && body.context && CONTEXT_EVENTS.has(event)) {
      return done(body.context);
    }
    return done();
  } catch {
    return done();
  } finally {
    clearTimeout(timer);
  }
}
void main();
