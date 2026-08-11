# Computer use & browser use in OpenGrokBot

Decision doc, 2026-08-12. How bots in OpenGrokBot get local computer use and
browser use, out of the box, with no separate installs. Based on a survey of
OSS chat-app MCP hosts, macOS control servers, browser-automation stacks, and
the local `cua` / `axstream` code on this machine.

## TL;DR architecture

```
Electron main process
├── EmbeddedCuaDriverHost  ──spawns──▶  cua-driver (bundled Rust binary, Resources/)
│     one TCC prompt, named OpenGrokBot          │ unix socket (private)
├── WebContentsView pool (embedded browser, persist: partitions per bot)
│     driven via webContents.debugger (CDP) — zero-install browser use
└── server/ harness (drivers spawn agent CLIs with --mcp-config)
      ├── computer-proxy-local.ts  ──▶ forwards MCP tool calls to driver socket
      └── computer-proxy.ts (existing) ──▶ remote/cloud box
```

- **Plugins = MCP servers over stdio.** The Plugins panel toggles which MCP
  servers get injected into each bot's `--mcp-config`. Same pattern as Claude
  Desktop / Cherry Studio / LibreChat.
- **Computer use = bundled `cua-driver`** (Rust, single static Mach-O,
  23MB arm64 / 48MB universal — from `mywork/cua/libs/cua-driver/rust`).
  NOT Swift — the Swift file everyone remembers
  (`examples/embedded-host-macos/ExampleAgentHarness.swift`) is a 165-line
  reference host showing the embedding pattern, not the driver.
- **Browser use = the app's own Chromium first.** Electron *is* Chromium;
  embed pages in `WebContentsView` and drive them via the built-in
  `webContents.debugger` CDP transport. No Chrome dependency, no 281MB
  Playwright download, and the user watches the bot browse inside the chat.

## Computer use: CUA only — bundle cua-driver, spawn from Electron main

**Decision (Milind, 2026-08-12): CUA is the ONLY computer-use provider.
No cliclick, no robotjs/nut.js, no Python computer-server, no fallbacks.**
Everything that touches the user's screen/mouse/keyboard goes through the
bundled `cua-driver` binary. Alternatives evaluated and rejected:

| Option | Verdict |
| --- | --- |
| cua `computer-server` (Python/FastAPI) | ✗ 200MB+ frozen Python, second TCC prompt under wrong identity |
| axstream (Python MCP + Vision OCR) | ✗ as a bundle (needs Python 3.11 + pyobjc); ✓ steal its ideas |
| cliclick / MacosUseSDK / robotjs-class native modules | ✗ rejected — CUA-only policy |
| **cua-driver Rust binary, embedded mode** | ✓ THE provider: zero deps, 20+ tools, MCP-over-stdio *and* socket daemon *and* TS SDK, agent-cursor overlay, permission tooling |

### The rules (from `cua/libs/cua-driver/rust/Skills/cua-driver/EMBEDDING.md` — read it end to end)

1. **Spawn from the Electron main process, never from the server/gateway
   layer.** macOS TCC attributes a spawned child to its "responsible process".
   Spawned from Electron main → the grant is OpenGrokBot's, users see ONE
   prompt named OpenGrokBot, and the bundled driver inherits it. Spawned from
   a Node gateway/daemon → the identity silently becomes the gateway's and
   `check_permissions` cannot detect the misattribution. The harness must ask
   Electron main for the driver socket path over IPC, not spawn the driver.
2. Use `EmbeddedCuaDriverHost` from `@trycua/cua-driver`
   (`libs/cua-driver/typescript/src/embedded.ts`, Electron helpers in
   `src/electron.ts`: `requestMacOSPermissions`, `hasRequiredMacOSPermissions`,
   `openMacOSScreenRecordingSettings`). Working reference:
   `typescript/test/electron-main-fixture.mjs`.
3. Env: `CUA_DRIVER_EMBEDDED=1` (exact value) + `CUA_DRIVER_HOST_BUNDLE_ID`.
   Permission mode `standard`.
4. Lifecycle: defer `before-quit` until `await embedded.stop()`; after a TCC
   grant change, destroy clients → `restart()` → reconnect (macOS caches TCC
   per process).

### Packaging

- Ship the binary at `OpenGrokBot.app/Contents/Resources/cua-driver`,
  **outside the ASAR**, executable bit preserved (electron-builder
  `extraResources`).
- **Re-sign it with our Team ID** before signing + notarizing the app (the
  installed copy is signed by trycua `YCK386LBJ7`). Biggest new build step.
- Info.plist: `NSAccessibilityUsageDescription`,
  `NSScreenCaptureUsageDescription` (mirror `/Applications/CuaDriver.app`'s
  strings).
- Onboarding: check → explain in-app → deep-link Settings panes
  (`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`
  and `?Privacy_ScreenCapture`). Expect macOS 15's ~monthly screen-recording
  re-prompt; the `persistent-content-capture` entitlement is Apple-gated and
  not realistically available to us.

### MCP exposure: `server/computer-proxy-local.ts`

Sibling of the existing cloud `computer-proxy.ts`, same house style (raw
JSON-RPC 2.0 over stdio, NO MCP SDK). Each tool call forwards to the embedded
daemon's socket; frame format is newline-delimited JSON:
`{"method":"call","name":<tool>,"args":<json>}\n` (see
`axstream/axstream/driver.py:_tool_socket`). Port axstream's
non-idempotent-retry guard verbatim (`driver.py:_IDEMPOTENT`): blind-retry
reads only, never clicks — prevents double-clicks after socket hiccups.

Driver tools available: click / double_click / right_click / drag / scroll /
type_text / press_key / hotkey / move_cursor / get_window_state /
get_desktop_state / get_accessibility_tree / list_windows / list_apps /
launch_app / bring_to_front / check_permissions / get_screen_size / zoom.
Delivery ladder inside the driver: `ax → ax_fg → cgevent → cgevent_fg →
cgevent_hid` (background pid-addressed input first; it does not steal the
user's cursor).

### Worth porting from axstream later (not bundling)

- Click ladder: AX element → OCR text anchor → visual patch anchor →
  window-relative pixel (`axstream/act.py`).
- Macro record/replay format (`macrofile.py`, `SPEC.md`) — this is how bots
  get "teach once, replay instantly".
- macOS Vision OCR is reachable without Python; `screen_text`/`find` can be
  reimplemented natively.

## Browser use: three tiers

1. **Default, zero setup: embedded browser.** `WebContentsView` inside the
   chat UI, `persist:bot-<id>` session partitions (logins survive restarts,
   per-bot isolation), normalized Chrome UA. Drive via `webContents.debugger`
   (built-in CDP: `Input.*`, `Runtime.*`, `Page.*`,
   `Accessibility.getFullAXTree` for playwright-mcp-style snapshot refs) +
   `capturePage()` for vision. User can grab the mouse mid-task for logins /
   CAPTCHAs, then hand back. Known limit: Google OAuth blocks embedded
   webviews — route Google-account flows to tier 2/3.
2. **Opt-in "use my real Chrome": extension bridge.** Chrome 136+ killed
   `--remote-debugging-port` on the default profile (do NOT build the old
   CDP-relaunch flow). The surviving path is playwright-mcp `--extension`
   mode (or Browser MCP) + the Web Store "Playwright Extension" — drives the
   user's logged-in tabs via `chrome.debugger`. Requires an extension install,
   so opt-in only.
3. **Opt-in power tier: bundled `@playwright/mcp`** launching system Chrome
   (`--browser chrome`, its default — no download when Chrome exists),
   persistent profile dir so logins stick. Optionally chrome-devtools-mcp for
   perf/Lighthouse/network tasks.

Skip browser-use (Python; wants to own the agent loop; even their own desktop
app doesn't embed it).

## Rollout order

1. `computer-proxy-local.ts` + spawn `cua-driver mcp` directly from Electron
   main in dev (unsigned dev builds inherit the terminal/Electron grant).
2. Permission onboarding UI (Plugins panel → "Computer" plugin card: status,
   grant buttons, deep links).
3. Embedded browser pane + a minimal CDP toolset (navigate / snapshot /
   click-ref / type / screenshot) exposed as the "Browser" plugin.
4. Packaging: extraResources + re-sign + notarize; wire
   `EmbeddedCuaDriverHost` for production.
5. Later: axstream-style macro teach/replay, extension bridge, playwright-mcp
   tier.
