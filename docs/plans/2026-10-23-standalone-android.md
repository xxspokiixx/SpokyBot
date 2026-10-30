# Plan: Standalone Android app — OpenMausBot on the phone

Run the whole OpenMausBot stack **on the Android device itself**: the harness,
the agents' engines, the transcripts and the UI. The phone app keeps the same
UI and settings as on the desktop, taps and long-presses instead of clicks,
and the Android keyboard types into the composer without any desktop keyboard
shim. This is a bigger step than today's phone story — it makes the phone a
host, not only a client — so the plan is written as feasibility gates plus
phased work with an explicitly limited first release.

Decisions this plan encodes (user-confirmed):

- **Connection model: standalone on-device.** Bots and agents run on the phone.
  Pairing remains only for *also* connecting this app to a desktop, a VPS or
  MausBot Cloud later — it is no longer the only way to use the app.
- **UI: same UI and settings as desktop.** Reuse the React UI build rather than
  re-achieving parity in a second UI engine. The native app in
  `SupaMaus/mausbot-mobile` remains the shell (app identity, lifecycle,
  phone capabilities); the served web UI is the settings-bearing surface.
- **Code placement per the standing rule** (`docs/superpowers/plans/2026-10-13-chat-widgets.md`):
  phone code in `mausbot-mobile`, desktop/server code in this repo. The one
  exception is the web UI itself, which lives here and is *served* to the phone
  — its touch adaptations land here and benefit every client (PWA included).

## Why

The phone today can only follow a desktop around: the iOS/Android companion
apps and the phone web app all pair with a machine that runs the agents. A
user who only has a phone cannot use OpenMausBot at all. A standalone app
completes the product: chat-driven agents in your pocket, data on the device,
no second computer needed — the same local-first promise the desktop makes.

## What exists today (verified)

Everything below exists and works; the plan builds on it, not over it.

**The harness is a plain Node program.** `pnpm build:server` bundles the whole
harness (`tsconfig.server.build.json` + `scripts/bundle-server.mjs`), and the
npm package (`npm install -g openmausbot`, `server/cli.ts`) already runs it
on whatever machine Node 24 exists. `scripts/capture-companion-fixtures.mjs`
boots a real harness against a temporary HOME to produce integration fixtures.

**The server serves the app itself.** `server/static-files.ts` serves the
built UI from `OMB_STATIC_DIR` with an SPA fallback; the packaged Electron app
just loads `http://127.0.0.1:$(SERVER_PORT)` (`electron/main.mjs`). A client
pointed at the server's origin gets the identical UI — that is the exact seam
a WebView will stand on.

**Auth is already designed for a device that owns the server.** Loopback
requests from the app that owns the process carry a per-launch owner
capability header (`server/request-auth.ts`); browsers *never* get loopback
trust; proxied requests are always remote. Pairing (`POST /api/auth/pairing`
→ one-time code; browser `POST /api/auth/pair` / native `POST /api/pair`)
mints a durable session — cookie for browsers, bearer for natives; SSE takes
a 5-minute ticket (`POST /api/auth/stream-ticket`, `GET /api/events?ticket=`).
`GET /.well-known/openmausbot/environment` publishes `environmentId` so a
client can verify *which* server it is talking to.

**Engines can run without spawning a single CLI.** The built-in
`openai-compat` driver is documented as "no process at all"
(`docs/custom-engines.md`): any OpenAI-compatible endpoint (OpenRouter, local
vLLM, OpenAI, DeepSeek, …) from a key in Settings → Engines, with structured
tools and image input, and the existing computer/approval machinery intact.
`server/drivers/*` do spawn CLIs (`server/procs.ts` `spawnCli`/`killCliTree`)
for the default engines — those are the only spawn-bound parts.

**The web UI is already touch-aware.** `src/styles.css` defines a `touch:`
custom variant (`@media (hover: none), (pointer: coarse)`), bumps composer
font-size to 16px under `(pointer: coarse)` (no Android focus-zoom), enforces
40px+ touch targets on table actions, and `src/components/touch-actions.test.ts`
guards that every hover-reveal is paired with a `touch:`/`max-md:` fallback. A
long-press gesture spec already exists (`src/components/MessageActions.tsx`,
`LONG_PRESS_MS = 450`). The sidebar is an off-canvas drawer below Tailwind
`md` with the hamburger in `src/App.tsx`; transcript bottom-follow already
handles touch gestures (`src/hooks/use-transcript-viewport.ts`); dialogs are
sized in `dvh`; `index.html` ships `viewport-fit=cover` + a `manifest.webmanifest`
(PWA install works today — no service worker by design).

**The sibling repo builds real Android artifacts.** `android/` (Kotlin core +
Gradle app, `:app:assemblePreview`) produces an APK that passes v2 signature
verification; `scripts/gen-app-fixtures.ts` in this repo copies the chat-app
host bundle into that checkout on every build, and the pairing contract lives
in `shared/pairing-link.ts` (`openmausbot://pair?…`, endpoint kinds
`hosted|tailnet|lan|bonjour`).

## What does NOT exist yet

- A Node runtime usable *inside* the app process on Android (Node ≥ 24);
  nothing in either repo packages one.
- A first-boot wizard that walks a phone user through key-based engines
  (the CLI has one — `server/cli.ts` "choose AI access, sign in or paste a
  hidden API key" — but it is terminal flow; the web UI assumes a configured
  host and offers MausBot Cloud).
- A full-screen (not `max-h-[85dvh]`) layout pass for dialogs, long-press
  equivalents for right-click context menus and double-click rename, and a
  touch affordance for reorder and for Mod+K-style shortcuts (today a
  PWA-only user also lacks these; the hardening is shared).
- Background execution strategy: routines/triggers live in-process
  (`croner`); nothing schedules work while the process is not running.

## Design in one paragraph

The Android app is an **on-device environments client whose host is itself**
— exactly the shape the desktop already implements, transposed. The Compose
app boots an **embedded Node harness** as a bound service listening only on
`127.0.0.1:8799` (`HOME` = app-private dir, `OMB_DATA_DIR` same, server
static dir = the React build extracted from APK assets), acts as its own
owner with the same per-launch capability Electron uses, and opens the
**same web UI** in a WebView pointed at `http://127.0.0.1:8799`. First-run
auth reuses the normal pairing machinery with zero server changes: the app (owner, loopback)
mints a one-time code and drives its own WebView through `/pair#code=…` once,
and the httpOnly session cookie then lives in the WebView's storage with the
server's usual 30-day slide. Engines v1 are key-based HTTP engines
(`openai-compat` family) configured in the same Settings → Engines UI;
spawned CLIs are a later, optional path. Paired desktop/cloud/VPS hosts keep
working through the *existing* companion stack — the same app gains an
environment switcher that treats "this device" as the default entry.

### Architecture (who owns what)

| Layer | Repo | Contents |
|---|---|---|
| Runtime kit | `mausbot-mobile` | Node ≥ 24 (`libnode` + bootstrap) for `android-arm64`, packaged with the APK; boot harness `dist-server` with app-private `HOME`; `/health` readiness probe; foreground service |
| Shell | `mausbot-mobile` | Compose app: onboarding, WebView activity, loopback network-security config, IME insets, file/mic/values bridges, app-link intents, environment switcher ("This device" + paired hosts), notifications |
| Harness web UI | this repo (`src/` + server) | The served React app; touch/keyboard hardening; capability descriptor additions; onboarding for key engines; lazy-gated native deps |
| Contracts | this repo (`shared/`, copied by scripts) | `pairing-link.ts`, wire types, environment descriptor extension (`platform: "android"`, capability flags) |

## Feasibility gates (do these before any bulk UI work)

1. **Node-on-Android runtime.** Spike a Node ≥ 24 `libnode`/SEA build for
   `android-arm64` (the `nodejs-mobile` patchset lineage is the realistic
   source; Node's own SEAs do not target bionic). Acceptance: boot the real
   `dist-server` bundle, answer `/health` and `/.well-known/…/environment`
   on loopback, serve `OMB_STATIC_DIR`, and run one `openai-compat` engine
   turn against a loopback fake. **Fallback if this fails:** document the
   Termux path (`npx openmausbot serve`, UI at `localhost:8799` in Chrome)
   with the app as a thin launcher — and revisit the runtime for Node 26.
2. **Native-dependency audit with lazy gates.** The two native modules in the
   server bundle are `@duckdb/node-api` and `@resvg/resvg-js`, both imported
   only inside `server/data/` (`engine.ts`, `render.ts` — the Data viewer and
   chart rendering). Make those imports lazy behind a platform check so the
   Android profile reports the affected panels unavailable with a reason
   (the model picker's "dimmed with the reason" pattern), and audit that the
   rest of `server/` has no hard native imports. Engine drivers also spawn —
   confirm "unavailable, never crash the fleet" holds when no CLI exists (it
   is designed to).
3. **Loopback + cleartext in one app.** Network security config allowing
   cleartext **to 127.0.0.1 only**; WebView keeps `httpOnly` session cookies
   (CookieManager persistence) and the server's `SameSite=Lax` cookie model
   works unchanged. Verify a WebView `fetch` actually sends `Sec-Fetch-Site`
   same-origin so the browser-not-loopback rule does not block the UI —
   if it does, the self-driven `/pair` flow above already covers it.

## Phases

Sizes: S ≤ a few days, M ≤ about two weeks, L longer / spans repos.

**Phase 0 — standalone v0 without any new code (S).** Document (and try, on a
real phone) the Termux route: install Node 24 + `openmausbot` from npm,
`openmausbot serve --no-open`, add an `openai-compat` engine key, open
`http://127.0.0.1:8799` in Chrome. Everything user-visible — chat, approvals,
settings, transcripts — should work; whatever does not, fix in `src/`
(Phase 2). This proves the engine and UI assumptions cheaply and gives
instant value: a working standalone story before the app exists.

**Phase 1 — runtime kit + boot harness (L, `mausbot-mobile`).**
`android/runtime` module: bundle libnode (gate 1 artifact), extract
`dist-server` and the UI build into filesDir, boot the harness with
app-private `HOME`/`OMB_DATA_DIR`, static dir, loopback-only bind,
per-launch owner capability — mirroring `electron/main.mjs`'s startServer.
Foreground service (`dataSync` type) "OpenMausBot is running", stop button
turns it off; crash → bounded auto-restart (reuse desktop recovery smoke's
approach, `docs/verification/desktop-server-recovery.md`).

**Phase 2 — web UI hardening (M, this repo).** All of it lands in the web UI
and therefore also benefits the PWA and the desktop browser story:

- Long-press everywhere right-click exists: extract the 450 ms
  `MessageActions` pattern into `src/lib/use-long-press-menu.ts` (+ unit
  tests) and apply to `SidebarThreadRow`/folder/section menus,
  `PinnedCircleThreads`, `TaskPicker`, transcript rows, approval cards.
  Menus already clamp to the viewport, so they are phone-safe.
- Every hover-only reveal gets its `touch:` partner (extend the existing
  `touch-actions.test.ts` list; this is where the tail risk hides).
- Double-click rename gets a menu item; reorder gestures get Move up/down
  menu entries as the touch path (drag reordering stays for pointer input).
- A reachable command affordance: sidebar-footer button opening the existing
  `CommandPalette` (Mod+K has no touch equivalent).
- Composer: add `interactive-widget=resizes-content` to the index.html
  viewport meta so Android's IME reserves space and the composer stays above
  the keyboard (Chrome 108+); assert the 16px coarse-pointer composer rule
  covers `MentionTextarea`; verify with the existing `Composer.ime.test.ts`
  plus a device check against a preview APK.
- Settings/panels: dialogs that currently stop at `max-h-[85dvh]` become
  full-screen sheets on `max-md` with sticky footers; Settings modal's 19
  sections keep the same keyboard but collapse like `SIMPLE_PAGES` do when
  advanced mode is off (they already do for the web case).

**Phase 3 — onboarding and engine setup for a hostless phone (M, this repo).**
The web UI's first-run path (WelcomeGate/MausBotWelcome) currently presumes a
configured host or cloud sign-up. Add an on-device onboarding that reuses the
CLI's decision shape: pick "paste an API key" → one `openai-compat` (or
OpenRouter) engine configured through the same `/api/…` config surface the
Settings Engines section already uses; endpoint-driven model catalog pops up
like it does for any custom instance. Model picker/provider gating already
shows "unavailable" fleet entries with the reason — reused as-is for the
desktop CLIs that cannot exist on the phone.

**Phase 4 — shell integration (M, `mausbot-mobile`).**
WebView activity: loads `http://127.0.0.1:8799` only after `/health` and the
environment descriptor check out (per `environmentId` discipline); self-driven
first pairing (as designed above); IME/window insets wiring; back-navigation
that closes drawers and menus before leaving the app; microphone capture
bridged for voice notes and calls (the app grants the page a MediaStream after
its own record-audio permission); attachments open the system file picker
through `WebChromeClient.onShowFileChooser`; downloads land in `MediaStore`;
theme-color and status-bar consistency for dark mode.

**Phase 5 — on-device lifecycle (M, both repos).** Battery-optimization
exemption opt-in *with* honest copy ("routines run while OpenMausBot is
running, backgrounded or not; exemption keeps them alive when Android would
freeze it"); a single notification channel holds live approvals and replies
(in-app notifications exist; out-of-app push delivery is explicitly out of
scope for v1, consistent with the iOS companion's status). Triggers work
while the service runs: routines fire on their schedules in the running
harness, but the webhook receiver stays a loopback port — public webhook
delivery to a phone needs a relay and is a follow-up.

**Phase 6 — release (M).** `:app:assembleRelease` APK v2-signed (the Gradle
signing recipe already exists); QA matrix on Android 12–16, small and locale
devices; a `docs/verification/standalone-android.md` recipe that boots a
fake-engine harness fixture in app-private directories, drives it with
`pnpm control:omb` against the loopback address, and records the native
WebView checks the control surface cannot drive (per house rule: state the
limitation rather than claim it).

## Testing strategy

- **Repos' defaults.** Web UI work: Vitest suites that already exist
  (`Composer.ime.test.ts`, `touch-actions.test.ts`, `use-transcript-viewport`,
  `sidebar`, `chat-polish`, `mentions`) extended for every touched surface;
  `pnpm typecheck`/`pnpm lint` as always.
- **Server/harness.** Fixture-first: control-omb launcher + fake engine; the
  companion fixtures pipeline (`scripts/capture-companion-fixtures.mjs`)
  covers out-of-host client behavior which the paired mode keeps using.
- **Native app.** `android/gradlew -p android :core:test :app:testDebugUnitTest`
  plus instrumented WebView checks on the preview APK (mic, file chooser,
  cookie persistence across app restarts). The existing 916-test / 462-test
  suites continue to pass unchanged.
- **Verification escapes no class of bug:** after any server or conversation
  change is claimed to work, per `AGENTS.md` + `docs/verification/README.md`,
  launch an isolated fixture (control-omb), drive through mapped commands
  (`pnpm control:omb`), and keep evidence (JSON of `wait`/`messages` and the
  printed log path). The standalone mode's *server-side* behavior is testable
  exactly like the desktop's, on the host; only the touch/IME/native checks
  are device-limited and get stated as such.

## Risks and open questions

- **Node ≥ 24 on bionic** is the plan's single load-bearing gate (Phase 0/1).
  If the patchset root is bad, the fallback Termux story still ships, but the
  polished "install an APK" story slips until a runtime exists for the newer
  LTS.
- **WebView treated as a browser** (`Sec-Fetch` headers mean browsers never
  get loopback trust — by design). The self-driven pairing flow gives the
  WebView a real session with no server changes. Verify a current WebView
  actually sends `Sec-Fetch-Site: same-origin` so every page request lands on
  the session path rather than falling through to ambiguous loopback
  treatment; if a faster path is ever wanted, a small WebView-origin rule in
  `request-auth` is possible, but owner-level loopback trust for the page
  itself is not worth the blast radius.
- **Storage and pruning**: transcripts and logs persist in app-private dirs
  that the user clears through Android storage settings, not a terminal. The
  existing Settings surfaces (backups, export, deletion) stay the path; no
  new surface.
- **Not addressed here:** Play Store listing and permissions review, FCM
  push delivery when the process is dead, keeping voice-call recording alive
  through aggressive battery modes, and the cloud/notification relay that
  closed-app push would need. A follow-up plan covers them once v0 has
  real-device evidence.

## Execution status (2026-10-23, local-only work session)

- **Server gates**: `mobileRefusal()` in `server/data/engine.ts:69` refuses the
  duckdb/resvg data engine on `android` or `OMB_MOBILE=1`; `/api/data*` answer
  `503 engine_unavailable`(render.ts shares the gate). Proven unchanged on
  Windows (`engine.mobile-gate.test.ts` + `engine.test.ts` green) and lint/typecheck green.
- **Touch hardening**: `src/lib/use-long-press-menu.ts` (450 ms, single LONG_PRESS_MS)
  wired into sidebar rows/sections/folders, TaskPicker, PinnedCircleThreads;
  CommandPalette button in the sidebar footer; touch-gated full-screen dialogs;
  `index.html` viewport got `interactive-widget=resizes-content`. vitest/lint/i18n/vite build green.
- **Staging**: `android-test/prepare-android-assets.mjs` builds
  `app/src/main/assets/omb/{server,ui,engine,skills}` + VERSION hash stamp
  (54.1 MB; engine staging covers `fake-claude-cli.ts`'s import closure —
  launch-note/room-handoff-agent/cleanup — one missing sibling breaks the
  driver probe silently, discovered by the smoke).
- **Smoke**: `android-test/smoke-bundle.mjs` boots the STAGED bundle with the
  boot-env env contract and proves the whole phone flow on Windows:
  health → environment → pairing mint → pair (cookie admin+client) →
  static UI → first-run starter bot on the fixture engine (`claude` selected)
  → a completed turn (fake engine reply in ~0.3 s). Final accepted state: all steps PASS.
  Windows caveats handled (root cause was "C:\Program Files" spaces vs the
  cli tokenizer; phone paths carry no spaces) — see README's smoke section.
- **Runtime**: Node v24.20.0 cross-compiled for android-arm64 (NDK r30,
  `android-configure`, 16 KB page-size LDFLAGS, `-static-libstdc++`) — BUILT,
  123,342,736 bytes, PIE + API 26, `DT_NEEDED` only libm/libdl/liblog/libc,
  LOAD alignment 0x4000 (evidence + patch record:
  `android-test/runtime/android-arm64/BUILD-NOTES.md`, six minimal
  deviations: zlib cpu-features + v8 trap-handler gyp conditions +
  `CC_host` pinning; no snapshot/code-cache, openssl no-asm by design of
  android cross builds). Staged into `jniLibs/arm64-v8a` by the prepare
  script. The binary could not run on the WSL x86 host; on-device
  verification is the remaining acceptance.
- **APK**: `:app:assembleDebug` green with assets + runtime packed;
  `apksigner verify` shows the Android Debug certificate, `zipalign -c -v 4`
  passes. `app/build/outputs/apk/debug/app-debug.apk`, 61,259,146 bytes,
  sha256 `c19571223c90087be4c198c760b5218d3e0353d4711b6f04860dde6e27771ccd`.
  `adb devices` shows no device attached on this machine — installation and
  the on-device boot screen remain to be observed on a phone.
- **Pairing app-side**: `NodeHostService.kt` seeds config.json (skipped if a
  config exists), spawns the runtime against `omb-installed/server/index.js`
  with the env contract (no `OMB_DESKTOP_PARENT`), pairs the WebView by
  exchange + CookieManager injection + `/api/auth/session` verify, restores an
  existing session across relaunches without re-minting.
- **On-device session 2026-10-23 (hardware)**: RedMagic NX733J first, then
  Samsung SM-P610 (Android 16). The runtime executes on-device; the first
  boot died silently in `acquireDataDirLeaseForProcess` — root cause:
  Android sepolicy denies `link(2)` inside the app's own data dir (EACCES
  on both OEMs), which the lease's and `loadEnvironmentId`'s atomic
  write-candidate+hard-link publishes depend on. Fixed via one shared
  `electron/atomic-publish.mjs` (android-only exists-check+rename fallback;
  desktop link protocol untouched — lease/env tests and the Windows smoke
  stay green). Also fixed the service double-spawning the server on
  activity re-entry (in-flight guard in `runBoot`). After the fixes the
  phone server boots and listens (`server.log` shows the banner), and the
  loopback contract passes on-device: health, environment
  (`platform:"android"`), pairing mint+pair (admin+client), session verify,
  static UI. Remaining: the first-run starter bot never settles — the
  fixture CLI probe (`readCliVersion`, 8 s `<cli> --version` timeout)
  reports `CLI not found` on-device while the same command run by hand
  answers `2.1.232 (Claude Code)` exit 0. Suspect: cold-start cost of the
  embedded runtime + TS type-stripping exceeding the 8 s probe timeout.
  Next: measure a single probe spawn, then either widen the probe timeout
  for android or stage the fixture engine pre-stripped to JS; rerun the
  on-device e2e (pair → starter bot → fixture turn) to completion.
- **Local desktop lane (same day, hardware)**: "this computer" is now a real
  Linux env on the phone — Alpine 3.22.7 aarch64 rootfs (bash, coreutils,
  python 3.12, git, curl) + Termux proot/loader, bundled in the APK under
  `assets/omb/linux/`, extracted by `ensureLocalComputer` with exec bits
  restored (`copyAssetDir` strips modes; the loader's missing x-bit was the
  real cause behind every misleading `execve("/bin/bash"): Permission denied`
  in this lane). Server gates are android-only and explicit-destination-only
  (`HOSTS_WITH_LOCAL_CONTROL` + android descriptor decode + tests). The MCP
  (`android-test/linux/android-local-computer.mjs`) exposes bash/read/write/
  list over `proot -R` with `PROOT_LOADER` (memfd exec is denied to apps);
  targetSdk 28 (Termux precedent, `untrusted_app_27` confirmed via `ps -Z`)
  unlocks app-data exec. On-device proof: app-domain self-test
  `linux-ok / aarch64 GNU/Linux / Python 3.12.15`, plus a stdio MCP session
  running a real guest command. A qemu-aarch64 fallback is built and
  documented but unstaged (loader path is 17 MB lighter). Fixture engine
  also now reports `available` on-device (android-aware probe timeouts +
  stale-cli repair after reinstalls). Full loopback contract re-verified:
  health, environment (platform android), pairing, session, static UI.
  Remaining acceptance: one real bot turn with destination "this computer"
  through the user's own engine (needs the user's go-ahead, their API).
- **WebView capability bridge (same day)**: the web UI's "Where {bot} works"
  picker greys out This PC in a plain WebView because it reads desktop
  capabilities from the Electron-only `window.ogb` preload. The shell now
  injects an `ombAndroidCaps` JS interface (`MainActivity`) and
  `src/lib/desktop.ts` synthesizes the payload from it (Tablet host, local
  computer ready). Verified on-device via logcat bridge probe + the
  untouched UI test suites (48 pass); the toggle is now reachable by touch.
- **`process.getuid` missing on the embedded node build (same day)**: with the
  toggle reachable, a turn still failed with "CUA Driver is not ready" — the
  descriptor's runtime validation compares the file's uid against
  `process.getuid?.() ?? -1`, and the android node build ships **no
  `process.getuid`**, so every descriptor failed its ownership check (-1 ≠
  10002). `descriptorUid()` (in `server/local-computer.ts`) now falls back to
  the uid of the process's own home directory — the same identity in the
  app's single-user sandbox. On-device probe: `readCuaConnection` returns the
  full android connection (`platform:"android"`,
  `scope:"local-computer"`). Regression test in the descriptor suite.
- **The descriptor's "mcp" contract tag (same day)**: with the connection
  accepted, the turn reached "MCP server exited before the session closed":
  `gatedLocalComputer` passed the descriptor's `args` (whose first element is
  the `mcp` subcommand tag the legacy CUA binary requires) to a command that
  on android is the node runtime itself — and node read the literal string
  "mcp" as its entry script. For android connections the tag is now stripped
  before it reaches argv (the desktop CUA path is unchanged); regression
  test added. On-device proof: driving the staged
  `local-computer-proxy.js` gate exactly as a turn does now completes
  `initialize` and `tools/list` through the MCP.
- **ACCEPTED (2026-10-23, user-run)**: a real turn on the user's own bot
  (their openaiCompat provider, configured through the tablet's settings UI)
  with destination "this computer" executed `uname -a` and
  `python3 --version` in the phone's Linux environment and answered in the
  chat: an aarch64 (arm64) Linux box running kernel 4.14.356 with Python
  3.12.15 — the tablet's real kernel and the rootfs's real interpreter.
  The full standalone loop is closed: on-device boot → desktop-parity UI →
  user-configured engine → local computer tools → real execution on the
  phone → answer in the chat.
- **Internet + browser lane (2026-10-24)**: the guest's DNS was dead (no
  /etc/resolv.conf anywhere for proot to bind) — the service now writes it
  every boot from the active network's resolvers; verified with curl → 200
  inside the guest. The browser required a guest pivot: Alpine's musl
  chromium runs `--version` but dies with SIGTRAP at headless startup, so
  the rootfs moved to Debian bookworm arm64 (docker layer + apt closure,
  chromium/python3/git/curl/fonts) — Debian's glibc chromium works. The
  tarball builder encodes three Android facts (no absolute-target symlinks,
  no hard links, /bin + /lib compat links); the harness launches the browser
  through `OMB_CHROME_PATH` = an NDK wrapper that re-execs Chrome's argv
  through proot (`OMB_BROWSER_SANDBOX=0`), `features.browser` was flipped on
  in the existing config via `PATCH /api/config`, and UI links now open in
  the system browser. Verified: `--dump-dom https://example.com` returns
  the fully rendered real page from Chromium 156 on the tablet. Remaining
  acceptance: one browsing turn through the user's engine.
- **Device apps control lane (2026-10-25)**: replaces Composio-style app
  connectors with direct control of the device's own apps via a granted
  AccessibilityService. Kotlin service on loopback TCP 8798 (a filesystem
  unix socket proved invisible across the device's mount views for the
  legacy targetSdk), MCP mirroring the desktop adb phone proxy's tool
  surface (status/read_screen/list_apps/open_app/tap_text/tap/swipe/
  type_text/press) including the phone claim protocol, and an android
  branch in `phoneIntegration`. On-device stdio verification: every tool
  answered correctly, including opening the real Settings app and reading
  the live window. Two lessons recorded: `onServiceConnected` re-fires
  (guarded, so a re-bind cannot orphan the first server), and app
  reinstalls reset the accessibility grant.
- **App sign-ins via the bot's browser (same day)**: the no-Composio app
  connector. Three fixes unlocked the existing flow on the phone: the
  browser engine kind switched to `chrome` (agent-browser publishes no
  android-arm64 build — flipped via `PATCH /api/config` + seeded), the
  `browserRuntimeEnv` allowlist now passes `OMB_ANDROID_LINUX_DIR` (the
  scrubbed env made the chromium wrapper exit 127), and the wrapper gained
  a build-time fallback path. Verified end-to-end server-side: the engine
  status resolves as `"kind":"engine" … "Chromium 156 (named by
  OMB_CHROME_PATH)"` — the launcher's pipe CDP handshake completes through
  proot. Bots sign into apps (Slack, Gmail, …) in their own streamed
  browser and keep those logins in persistent profiles.
- **System notifications (same day)**: bot messages never reached the tray
  because the web Notification API is never granted in a plain WebView.
  `src/lib/notify.ts` falls back to the `ombAndroidCaps` bridge and
  MainActivity posts a system notification ("Bot messages" channel, tap
  opens the app); POST_NOTIFICATIONS was already requested at first launch.
  Verified the bridge exposes `notify` as a function in the live WebView.
- **Rebrand (same day)**: the shipped app now presents as SpokyBot — a
  staging-time transform (prepare-android-assets.mjs) rewrites every
  "OpenMausBot"/"MausBot" in the staged server/UI/engine/skills trees
  (case-sensitive; lowercase protocol identifiers untouched), plus the
  shell strings (launcher, boot screen, notifications, accessibility
  service, WebView UA, fixture display name). The repo source keeps its
  own product name; user data (bot names, existing config) untouched by
  design; the internal package id stays because the baked paths and
  grants depend on it. Verified: /api/brand → {"name":"SpokyBot"}, page
  title SpokyBot, application-label 'SpokyBot'.
- **OpenCode engine lane (same day)**: the user's "set up OpenCode login and
  use its models" — the built-in opencodeGo engine now runs on the phone:
  the opencode CLI 1.19.4 (linux-arm64, glibc) ships in the trixie rootfs;
  the driver's android default cli is the proot chain with an identity
  bind + writable /tmp; the app auto-inserts the engine instance into
  config.json when missing (OMB hides it from custom-instance configs)
  and mirrors the stored key to OPENCODE_API_KEY at boot (the server only
  mirrors on patch); the service env exports the whole proot contract
  (LD_LIBRARY_PATH, PROOT_TMP_DIR/NO_SECCOMP/LOADER/memfd) for chains the
  server spawns itself. Plus trixie's ca-certificates lesson (Recommends
  + no maintainer scripts → builder assembles the bundle itself).
  Verified live: **state available, version 1.19.4, 112 models**, default
  opencode/beam-free.
