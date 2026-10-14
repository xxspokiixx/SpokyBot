// Run with: node scripts/smoke-app-frames.mjs [--engagement]
// Linux CI needs xvfb-run.
//
// The Electron security test for chat app frames
// (docs/superpowers/specs/2026-10-14-chat-apps-design.md, "Security rules",
// rules 1 to 6 and 8). A real AppDocument comes from the server's own path
// (server/chat-apps.ts: show_html stored, then served as a document); the
// frame is mounted by the desktop's own frame host
// (src/components/app/app-frame-host.ts, bundled here) inside a page served
// with the app's headers, in a window with the app's navigation guard, window
// open handler and permission handlers. The page inside the frame tries
// every way out it can, and an HTTP sink on this machine must stay empty.
//
// --engagement also clicks into two frames, one after the other, to check that
// focus entering a frame by the pointer counts as engagement, and that moving
// to the other frame moves it (focus is emulated: the window stays hidden).
import electron from "electron";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// A page pinned to the viewport with its content centred, the way bots often
// write one: the frame must still grow to the content, not report its own
// height back (the content would spill out above and below).
const PINNED = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center}</style></head>
<body><div style="height:300px;width:120px;background:#888"></div></body></html>`;

// The page a bot would send with show_html. SINK and WSSINK are filled in
// with the sink's address. Each attempt reports what happened; the frame
// posts the report to its parent, then tries to navigate itself.
const PROBE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Probe</title>
<link rel="prefetch" href="SINK/prefetch">
<link rel="stylesheet" href="SINK/style.css">
<style>.bg{width:8px;height:8px;background-image:url(SINK/css-image)}</style>
<script src="SINK/script.js"></script>
</head><body>
<div class="bg"></div>
<img id="img" src="SINK/img.png" alt="">
<form id="form" action="SINK/form" method="post" target="_self"><input name="a" value="1"></form>
<a id="blank" href="SINK/blank" target="_blank">blank</a>
<a id="self" href="SINK/self">self</a>
<iframe src="SINK/frame"></iframe>
<object data="SINK/object"></object>
<audio src="SINK/audio" autoplay></audio>
<script>
(async () => {
  const out = { origin: self.origin, inlineScript: true };
  const attempt = async (name, run) => {
    console.log("probe: " + name);
    try { out[name] = { ok: true, value: String(await run()) }; }
    catch (error) { out[name] = { ok: false, error: String((error && (error.name || error.message)) || error) }; }
  };
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
  out.preload = typeof window.ogb;
  out.webkitHandlers = typeof (window.webkit && window.webkit.messageHandlers);
  out.androidAppHost = typeof window.appHost;
  out.helper = typeof (window.mausbot && window.mausbot.send);
  await attempt("fetch", () => Promise.race([fetch("SINK/fetch").then((r) => r.status), timeout(3000)]));
  await attempt("xhr", () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "SINK/xhr");
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => reject(new Error("xhr error"));
    xhr.send();
  }));
  await attempt("websocket", () => new Promise((resolve, reject) => {
    const socket = new WebSocket("WSSINK/ws");
    socket.onopen = () => resolve("open");
    socket.onerror = () => reject(new Error("websocket error"));
  }));
  await attempt("beacon", () => navigator.sendBeacon("SINK/beacon", "x"));
  await attempt("localStorage", () => localStorage.length);
  await attempt("cookie", () => document.cookie);
  await attempt("parentDocument", () => parent.document.title);
  await attempt("windowOpen", () => window.open("SINK/open"));
  await attempt("topLocation", () => { top.location = "SINK/top"; return "assigned"; });
  await attempt("clipboard", () => Promise.race([navigator.clipboard.writeText("x").then(() => "written"), timeout(3000)]));
  let submitted = false;
  document.getElementById("form").addEventListener("submit", () => { submitted = true; });
  await attempt("formPost", () => { document.getElementById("form").requestSubmit(); return "submitted"; });
  out.onsubmitFired = submitted;
  await attempt("blankLink", () => { document.getElementById("blank").click(); return "clicked"; });
  await attempt("microphone", () => Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().length), timeout(3000)]));
  await attempt("camera", () => Promise.race([navigator.mediaDevices.getUserMedia({ video: true }).then((s) => s.getTracks().length), timeout(3000)]));
  await attempt("displayMedia", () => Promise.race([navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => s.getTracks().length), timeout(3000)]));
  await attempt("geolocation", () => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(() => resolve("position"), (error) => reject(new Error("geolocation " + error.code)), { timeout: 3000 });
  }));
  await attempt("notification", () => Notification.requestPermission());
  await attempt("sendUnengaged", () => window.mausbot.send("hello from a page nobody clicked"));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const img = document.getElementById("img");
  out.imageLoaded = img.complete && img.naturalWidth > 0;
  parent.postMessage({ probe: out }, "*");
  // Rule 5 last: the frame navigates itself, by a link and by location.
  setTimeout(() => { document.getElementById("self").click(); }, 200);
  setTimeout(() => { location.href = "SINK/location"; }, 600);
})();
</script></body></html>`;

/** A tiny page for the engagement check. */
const CLICKABLE = (name) => `<!DOCTYPE html><html><body style="margin:0"><button id="b" style="width:100%;height:120px">${name}</button></body></html>`;
/** A page that takes focus by itself, with no click and no pointer over it. */
const GRABBER = `<!DOCTYPE html><html><body style="margin:0"><button id="b" style="width:100%;height:120px">grab</button>
<script>setTimeout(() => { window.focus(); document.getElementById("b").focus(); }, 300);</script></body></html>`;

// ── parent: build the document, bundle the host, run Electron, read the sink ──
if (!process.versions.electron) {
  const { build } = await import("esbuild");
  const { createChatApps } = await import("../server/chat-apps.ts");
  const { BOT_HTML_CSP } = await import("../shared/app-frame/csp.ts");
  const { CSP_META_PREFIX } = await import("../shared/app-frame/document.ts");
  const engagement = process.argv.includes("--engagement");

  const sinkHits = [];
  const sinkConnections = [];
  const sink = createServer((req, res) => {
    sinkHits.push(`${req.method} ${req.url}`);
    res.setHeader("access-control-allow-origin", "*");
    res.end("sink");
  });
  sink.on("upgrade", (req, socket) => { sinkHits.push(`UPGRADE ${req.url}`); socket.destroy(); });
  sink.on("connection", () => sinkConnections.push(Date.now()));
  await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
  const sinkOrigin = `http://127.0.0.1:${sink.address().port}`;

  const data = mkdtempSync(join(tmpdir(), "omb-app-frame-smoke-"));
  let code = 1;
  try {
    // A real document, through the server's own show_html path.
    const rows = new Map();
    const thread = (id) => rows.get(id) ?? rows.set(id, []).get(id);
    let next = 1;
    const store = {
      groupByThread: () => undefined,
      messagesFor: thread,
      appendMessage: (threadId, message) => { const row = { ...message, id: `m${next++}`, at: Date.now() }; thread(threadId).push(row); return row; },
      patchMessage: (threadId, messageId, patch) => {
        const list = thread(threadId);
        const index = list.findIndex((row) => row.id === messageId);
        if (index === -1) return null;
        list[index] = { ...list[index], ...patch };
        return list[index];
      },
    };
    const apps = createChatApps({ store, dataDir: data, sweeps: false, references: () => [] });
    const page = (html, title) => {
      const shown = apps.createAppCard({ bot: { id: "bot-probe", name: "Probe" }, threadId: "t-probe", input: { tool: "show_html", html, title } });
      assert.equal(shown.ok, true, JSON.stringify(shown));
      const doc = apps.appDocument("t-probe", shown.messageId, "confirm");
      assert.ok(doc, "the stored page is served as a document");
      return doc;
    };
    const probeDoc = page(PROBE.replaceAll("WSSINK", sinkOrigin.replace("http:", "ws:")).replaceAll("SINK", sinkOrigin), "Probe");
    const pinnedDoc = page(PINNED, "Pinned");
    apps.close();
    // Rules 2 and 3, on the document the frame gets.
    assert.ok(probeDoc.srcdoc.startsWith(`${CSP_META_PREFIX}${BOT_HTML_CSP}">`), "rule 2: the CSP meta comes first, with the bot policy");
    assert.equal(probeDoc.csp, BOT_HTML_CSP, "rule 3: the bot policy, exactly");
    const clickDocs = engagement ? [page(CLICKABLE("first"), "First"), page(CLICKABLE("second"), "Second"), page(GRABBER, "Grabber")] : [];

    const bundle = await build({
      stdin: {
        contents: "import { mountAppFrame, APP_FRAME_SANDBOX } from \"./app-frame-host.ts\";\nwindow.__appFrameHost = { mountAppFrame, APP_FRAME_SANDBOX };\n",
        resolveDir: join(ROOT, "src/components/app"), sourcefile: "smoke-entry.ts", loader: "ts",
      },
      bundle: true, write: false, format: "iife", platform: "browser", target: ["chrome120"],
    });
    const input = join(data, "input.json");
    writeFileSync(input, JSON.stringify({ probeDoc, pinnedDoc, clickDocs, hostScript: bundle.outputFiles[0].text, sinkOrigin, engagement }));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [fileURLToPath(import.meta.url), data, input], { stdio: "inherit", env });
    // Generous: a loaded machine starts Electron slowly.
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    code = await new Promise((resolve) => child.on("exit", (status, signal) => {
      if (signal) console.error(`Electron ended on ${signal}`);
      resolve(status ?? 1);
    }));
    clearTimeout(timer);
    // Electron's exit can drop piped output: the child writes its report to a file.
    for (const name of ["report.json", "heights.json", "engagement.json", "error.txt", ...(code === 0 ? [] : ["console.txt"])]) {
      try { console.log(readFileSync(join(data, name), "utf8")); } catch { /* not written */ }
    }
    // Everything in the frame has had its chance: the sink saw nothing.
    if (code === 0) {
      assert.deepEqual(sinkHits, [], `the sink received requests from the frame: ${sinkHits.join(", ")}`);
      console.log(`sink: 0 requests (${sinkConnections.length} bare connections)`);
      console.log("app frame smoke: ok");
    }
  } catch (error) {
    console.error(error);
    code = 1;
  } finally {
    sink.close();
    rmSync(data, { recursive: true, force: true });
  }
  process.exit(code);
}

// ── child: Electron ──
const { app, BrowserWindow, session } = electron;
const [data, inputPath] = process.argv.slice(2);
assert.ok(data && inputPath, "Run this smoke with Node so its parent owns the temporary profile");
app.setPath("userData", data);
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
const { appFrameNavigationAllowed } = await import("../electron/app-frame-guard.mjs");
const { appPermissionHandlers } = await import("../electron/app-permissions.mjs");
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const report = (name, text) => writeFileSync(join(data, name), text);
/** A line of what happened, for a smoke that stalls. */
const trace = (line) => { try { writeFileSync(join(data, "console.txt"), `${line}\n`, { flag: "a" }); } catch { /* best effort */ } };
// An uncaught error would open Electron's modal error box and stall the run.
process.on("uncaughtException", (error) => { report("error.txt", `uncaught: ${error?.stack ?? error}`); app.exit(1); });
const timeout = setTimeout(() => { report("error.txt", "App frame smoke timed out"); app.exit(1); }, 200_000);

// The host page: the app's own headers, the frame host, a record of what the
// bridge's adapter was asked to do.
const HOST_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>App frame smoke</title></head>
<body style="margin:0;width:700px"><div id="frames"></div>
<script>${input.hostScript.replace(/<\/script/gi, "<\\/script")}</script>
<script>
  window.__probe = null;
  window.__calls = [];
  window.__hosts = {};
  addEventListener("message", (event) => { if (event.data && event.data.probe) window.__probe = event.data.probe; });
  window.__mount = (name, doc) => {
    const box = document.createElement("div");
    box.id = "box-" + name;
    document.getElementById("frames").appendChild(box);
    const record = (op) => (...args) => { window.__calls.push({ frame: name, op, args: JSON.parse(JSON.stringify(args)) }); return Promise.resolve({}); };
    window.__hosts[name] = window.__appFrameHost.mountAppFrame({
      container: box, doc, title: name, height: 160, hostVersion: "smoke",
      hostContext: { theme: "light", containerDimensions: { width: 700, maxHeight: 600 } },
      adapter: {
        callRpc: record("rpc"), sendMessage: record("message"), openLink: record("open-link"), setContext: record("context"),
        resize: (height) => { window.__calls.push({ frame: name, op: "resize", args: [height] }); }, teardownRequested: record("teardown-request"),
      },
    });
  };
</script></body></html>`;

async function run() {
  const host = createServer((_req, res) => {
    // server/index.ts PAGE_HEADERS
    res.setHeader("content-security-policy", "frame-ancestors 'none'");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(HOST_PAGE);
  });
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${host.address().port}`;
  await app.whenReady();
  // A hidden window's app is otherwise napped by macOS, and its timers with it.
  electron.powerSaveBlocker.start("prevent-app-suspension");
  const preload = join(data, "preload.cjs");
  // A stand-in for the app's preload bridge (rule 6).
  writeFileSync(preload, `require("electron").contextBridge.exposeInMainWorld("ogb", { openExternal: () => Promise.resolve(true), marker: "preload" });`);
  const win = new BrowserWindow({
    show: false, width: 760, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload },
  });
  const permissionAsks = [];
  const permissions = appPermissionHandlers({ rendererOrigin: () => origin, mainContents: () => win.webContents, cloudHomeOrigin: () => null, cloudHomeRestoring: () => null });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    permissions.request(contents, permission, (granted) => {
      permissionAsks.push({ permission, origin: details?.requestingUrl ?? "", isMainFrame: details?.isMainFrame, granted });
      callback(granted);
    }, details);
  });
  session.defaultSession.setPermissionCheckHandler((...args) => permissions.check(...args));
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    permissionAsks.push({ permission: "display-media", origin: request.securityOrigin, granted: false });
    callback({});
  });
  const opens = [];
  win.webContents.setWindowOpenHandler(({ url }) => { opens.push(url); return { action: "deny" }; });
  // electron/main.mjs's guard, as main.mjs installs it.
  const navigations = [];
  win.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    const allowed = appFrameNavigationAllowed(details);
    let frameOrigin;
    try { frameOrigin = details.frame?.origin; } catch (error) { frameOrigin = `unreadable: ${error.message}`; }
    navigations.push({ url: details.url, origin: frameOrigin, allowed });
    trace(`navigation ${details.url} ${frameOrigin} ${allowed}`);
    if (!allowed) details.preventDefault();
  });
  // What the frame says it is doing, for a smoke that stalls.
  win.webContents.on("console-message", (event) => trace(event.message));
  await win.loadURL(origin);
  const js = (code) => win.webContents.executeJavaScript(code, true);

  // Rule 6, the control: the host page has the preload bridge.
  assert.equal(await js("typeof window.ogb"), "object");
  await js(`window.__mount("probe", ${JSON.stringify(input.probeDoc)})`);
  // Rule 1, from the host's side.
  const attrs = await js(`(() => { const f = document.querySelector("#box-probe iframe"); return { sandbox: f.getAttribute("sandbox"), allow: f.hasAttribute("allow"), srcdoc: f.getAttribute("srcdoc") === ${JSON.stringify(input.probeDoc.srcdoc)} }; })()`);
  assert.deepEqual(attrs, { sandbox: "allow-scripts allow-forms", allow: false, srcdoc: true }, "rule 1: the frame element");

  const deadline = Date.now() + 120_000;
  let probe = null;
  while (!probe && Date.now() < deadline) {
    probe = await js("window.__probe");
    if (!probe) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(probe, "the frame reported");
  trace("step: reported");
  // The frame's two self-navigations (a link, then location) come after its report.
  const navigated = Date.now() + 60_000;
  while (navigations.filter((entry) => entry.url.startsWith(input.sinkOrigin)).length < 2 && Date.now() < navigated) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  trace("step: waited");
  const calls = await js("window.__calls");
  trace("step: calls");
  const frameUrl = await js(`(() => { try { return document.querySelector("#box-probe iframe").contentWindow.location.href; } catch (e) { return "cross-origin"; } })()`);
  report("report.json", JSON.stringify({ probe, navigations, opens, permissionAsks, calls, frameUrl }, null, 2));

  // Rule 1: the frame's origin is opaque. The inline script ran.
  assert.equal(probe.origin, "null", "rule 1: origin");
  assert.equal(probe.inlineScript, true);
  // Rule 4: nothing leaves, nothing is read.
  for (const name of ["fetch", "xhr", "websocket", "localStorage", "cookie", "parentDocument", "topLocation", "clipboard"]) {
    assert.equal(probe[name].ok, false, `rule 4: ${name} must fail (${JSON.stringify(probe[name])})`);
  }
  // sendBeacon answers true when it queues; the CSP then blocks the request,
  // which the sink (checked by the parent) proves.
  assert.deepEqual(probe.windowOpen, { ok: true, value: "null" }, "rule 4: window.open returns null");
  assert.equal(probe.onsubmitFired, true, "rule 4: onsubmit still fires");
  assert.equal(probe.imageLoaded, false, "rule 4: an undeclared image does not load");
  // Chromium lists CSP-blocked loads in resource timing too, so whether a CSS
  // image, a script or a prefetch went out is the sink's to say.
  assert.deepEqual(opens, [], "rule 4: target=_blank and window.open reach no handler");
  // Rule 5: the frame's own navigations were seen and stopped.
  const sinkNavigations = navigations.filter((entry) => entry.url.startsWith(input.sinkOrigin));
  assert.ok(sinkNavigations.length >= 1, "rule 5: the frame tried to navigate itself");
  // Each was cancelled. The first is seen with the opaque origin; a second one
  // right after it may find the frame's old render frame already gone, which
  // the guard treats as unreadable and cancels too.
  for (const entry of sinkNavigations) assert.equal(entry.allowed, false, `rule 5: ${entry.url} (${entry.origin})`);
  assert.equal(sinkNavigations[0].origin, "null", "rule 5: an app frame's navigation is seen with an opaque origin");
  assert.equal(frameUrl, "cross-origin", "the frame is still its own opaque document");
  // Rule 6: no host bridge in the frame.
  assert.deepEqual([probe.preload, probe.webkitHandlers, probe.androidAppHost], ["undefined", "undefined", "undefined"], "rule 6");
  assert.equal(probe.helper, "function", "the bot helper is there");
  // Rule 8: no device permission for the frame.
  for (const name of ["microphone", "camera", "displayMedia", "geolocation"]) assert.equal(probe[name].ok, false, `rule 8: ${name} (${JSON.stringify(probe[name])})`);
  assert.notEqual(probe.notification.value, "granted", "rule 8: notifications");
  assert.deepEqual(permissionAsks.filter((ask) => ask.granted), [], "rule 8: nothing granted");
  // The bridge: a message nobody clicked for is refused, and nothing was sent.
  assert.equal(probe.sendUnengaged.ok, false, "an unengaged mausbot.send is refused");
  assert.deepEqual(calls.filter((call) => call.op === "message"), [], "no message reached the send route");

  // A page pinned to the viewport grows the frame to its content (300px).
  await js(`window.__mount("pinned", ${JSON.stringify(input.pinnedDoc)})`);
  let pinned = 0;
  for (let waited = 0; waited < 20_000 && pinned < 300; waited += 250) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    pinned = await js(`Math.max(0, ...window.__calls.filter((call) => call.frame === "pinned" && call.op === "resize").map((call) => call.args[0]))`);
  }
  assert.ok(pinned >= 300, `a page pinned to the viewport reports its content's height, not the frame's (got ${pinned})`);
  report("heights.json", JSON.stringify({ pinned }));

  if (input.engagement) await checkEngagement(win, js);
  await win.webContents.executeJavaScript("1");
  win.destroy();
  host.close();
}

/** Click into one frame and then the other: the frame each click lands in
 * is engaged, the other is not. */
async function checkEngagement(win, js) {
  // A window this smoke opens cannot count on taking the system's focus (a
  // terminal keeps it), so the page is told it has focus, the way DevTools
  // emulates it. Clicks then move focus between frames as they would.
  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  win.webContents.focus();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const [first, second, grabber] = input.clickDocs;
  await js(`document.getElementById("box-probe").remove(); window.__mount("first", ${JSON.stringify(first)}); window.__mount("second", ${JSON.stringify(second)});`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const rect = async (name) => js(`(() => { const r = document.querySelector("#box-${name} iframe").getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + 40) }; })()`);
  const click = async (point) => {
    win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
    await new Promise((resolve) => setTimeout(resolve, 100));
    win.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));
  };
  const engaged = () => js(`({ first: window.__hosts.first.engaged(), second: window.__hosts.second.engaged(), focused: document.hasFocus() })`);
  const before = await engaged();
  await click(await rect("first"));
  const afterFirst = await engaged();
  await click(await rect("second"));
  const afterSecond = await engaged();
  // A frame that focuses itself, the pointer elsewhere, is not engaged.
  await js(`window.__mount("grabber", ${JSON.stringify(grabber)})`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const grabbed = await js(`({ grabber: window.__hosts.grabber.engaged(), active: document.activeElement === document.querySelector("#box-grabber iframe") })`);
  report("engagement.json", JSON.stringify({ engagement: { before, afterFirst, afterSecond, grabbed } }));
  assert.deepEqual([before.first, before.second], [false, false], "nobody clicked yet");
  assert.deepEqual([afterFirst.first, afterFirst.second], [true, false], "a click in the first frame engages it");
  assert.deepEqual([afterSecond.first, afterSecond.second], [false, true], "a click in the second frame moves engagement");
  assert.equal(grabbed.grabber, false, "a frame that focuses itself is not engaged");
}

run().then(() => {
  clearTimeout(timeout);
  app.exit(0);
}, (error) => {
  report("error.txt", String(error?.stack ?? error));
  clearTimeout(timeout);
  app.exit(1);
});
