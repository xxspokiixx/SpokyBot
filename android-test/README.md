# OpenMausBot — local-only Android test shell

This directory holds a **test-only, never-published** Gradle app that runs the
OpenMausBot harness (the `dist-server` Node bundle) inside an on-device Node
runtime and opens the served web UI in a full-screen WebView pointing at
`http://127.0.0.1:8799`. It exists to prove the embedded-runtime + WebView +
pairing bootstrap on a real phone before the production shell is built. It is
not the product app (`mausbot-mobile` stays the production home).

Everything here is local: **no store listing, no signing keys, no CI, nothing
is uploaded.** `android-test/` is ignored by the repo-root `.gitignore`.

## Contents

```
android-test/
  settings.gradle.kts      Gradle 9.1.0, plugin repos (google(), mavenCentral(), portal)
  build.gradle.kts         AGP com.android.application 9.0.0-alpha09
  gradle.properties        2 GB daemon heap, parallel + caching on
  gradlew / gradlew.bat    wrapper pinned to gradle-9.1.0-bin
  local.properties         sdk.dir point but NOT committed (gitignored)
  app/
    AndroidManifest.xml    INTERNET + FOREGROUND_SERVICE(_DATA_SYNC) + POST_NOTIFICATIONS
                           cleartext only to 127.0.0.1/localhost via the XML below
    MainActivity.kt        boot screen → WebView, file chooser, IME insets,
                           back handling, status bar #070707 (manifest theme_color)
    NodeHostService.kt     dataSync foreground service: extract assets, spawn node,
                           poll health/environment, run the pairing handshake,
                           keep session cookie in WebView CookieManager, log tailing
    NodeState.kt           single StateFlow the boot screen and the activity read
    res/xml/network_security_config.xml   cleartextTrafficPermitted=false except 127.0.0.1/localhost
```

The project deliberately uses **no Compose, no Firebase, no androidx
libraries** — only the Android framework, Kotlin stdlib and
`kotlinx-coroutines-android`. AGP 9 applies Kotlin support itself; the classic
`org.jetbrains.kotlin.android` plugin must NOT be added (AGP 9 rejects it).

## What the app expects inside the APK

```
app/src/main/assets/omb/VERSION          marker text; any change forces re-extract
app/src/main/assets/omb/server/**        contents of the repo's dist-server/**
                                         (index.js at server/index.js — the
                                         entry name the service spawns — plus
                                         model-catalog/ and package.json)
app/src/main/assets/omb/ui/**            contents of the repo's vite build (dist/**);
                                         handed to the server as OMB_STATIC_DIR
app/src/main/assets/omb/engine/**        the fixture engine (server/testing/
                                         fake-claude-cli.ts + its import closure)
app/src/main/assets/omb/skills/**        bundled skills library (OMB_SKILLS_DIR)
app/src/main/jniLibs/arm64-v8a/libnodeexec.so   the cross-compiled node runtime
```

`prepare-android-assets.mjs` fills `assets/omb/` from the repo's build outputs
(and copies `runtime/android-arm64/libnodeexec.so` into jniLibs when that
artifact exists); the code tolerates assets missing entirely: missing
`omb/VERSION` surfaces **bundle missing** on the boot screen instead of an
endless spinner. The runtime binary is NOT in assets: the service loads
`<nativeLibraryDir>/libnodeexec.so` and spawns
`<filesDir>/omb-installed/server/index.js` (the bundle lives flat at the root
of `dist-server`; ESM comes from its `package.json` type). Until the runtime
lands, the boot screen says **runtime binary pending**.

The service seeds `<filesDir>/data/config.json` on first boot (skipped when a
config.json already exists): `features.browser:false` (the desktop-Chrome
launcher would try to download a browser on the phone), `features.skillsLibrary:true`,
and one fixture engine instance pointing the claude driver's `cli` at
`<libnodeexec.so> <omb-installed>/engine/fake-claude-cli.ts` — the
space-separated "bin script" shape `resolveCliSpawn` tokenizes on non-Windows
platforms (phone paths contain no spaces).

## States the boot screen can show

| status | meaning |
|---|---|
| `Extracting the server bundle…` | copying assets into `<filesDir>/omb-installed` |
| `Bundle missing` | APK ships no `omb/` assets yet |
| `Runtime binary pending` | `libnodeexec.so` not packed into this jniLibs set |
| `Starting the harness…` | node spawned, health not answered yet |
| `Harness answering — checking environment…` | `/api/health` answered, waiting for the environment report |
| `Pairing the WebView…` | pairing handshake in progress |
| `Opening the app…` → WebView | paired; WebView loads `http://127.0.0.1:8799/` |
| `Failed.` + log tail + Retry | server never booted / crashed 4 times / pairing refused |

Server output streams to `<filesDir>/logs/server.log` (single file, recreated
past 5 MB) and the last 2 KB are shown on failures.

## Pairing flow (implemented)

**Why the phone harness runs without `OMB_DESKTOP_PARENT=1`:** that mode is
built for an Electron parent and gates server-changing routes behind a
43-character mutation capability that ONLY an Electron `utilityProcess`
message port can deliver (`openmausbot:desktop-mutation-token` through
`process.parentPort`). A plain `node index.js` spawn starts with an empty
token, so `POST /api/auth/pairing` answers
`403 forbidden: this change must come from the desktop app or a paired
device` and no code can ever be minted. Running with the variable unset uses
the self-hosted default: non-browser loopback requests act as the owner
(server/request-auth.ts skips the mutation gate when the token is absent),
while the WebView keeps its browser classification and still needs the pair
session below. Verified against a real harness boot on Windows (health →
environment → mint → pair → cookie session all 200).

1. After the environment report answers with `environmentId`, the service
   `POST /api/auth/pairing` with `{"label":"Windows-PC-DE2F"}`. The response
   carries `{id, code, credential, expiresAt, url, inviteUrl, serverName,
   hint}`; the service consumes the human `code` (base32 format).
2. It redeems the code **itself**: `POST /api/auth/pair` JSON
   `{code,label,cookie:true,attemptId}` (content-type application/json, as
   the server requires; the label tells the server the session device), and
   parses the `Set-Cookie` header
   (`omb_session_<port>_<environmentId>=…; Path=/; HttpOnly; Max-Age=…`).
3. Each cookie is pushed into `android.webkit.CookieManager` for
   `http://127.0.0.1:8799/` and flushed, then verified by
   `GET /api/auth/session` carrying the cookie. Only then does the WebView
   attach, so the first page load already holds the session.
4. On later launches the existing CookieManager cookies are reused when
   verification passes, so no re-pairing happens.

If verification fails the boot screen stays with the reason — the fallback
(one tap on `/pair#code=…`) is intentionally not wired; codes minted here are
already single-use and short-lived, so re-pressing Retry mints a fresh one.

## Lifecycle notes

- The foreground service is `dataSync`-typed. Android 15 caps that type at
  6 h per 24 h when targetSdk ≥ 35; `onTimeout` stops node, posts a
  "Server paused — tap Resume" notification whose action restarts the
  service. This is accepted behaviour for a test build, not a production
  background story.
- Node crashes before the first successful health check trigger up to 3
  restarts, then the boot screen shows the log tail; any exit while Ready
  posts "server stopped" with a Resume action.
- Rotation: the activity declares `configChanges`, the WebView survives;
  switching apps leaves the service (and the server) running.

## Building

One-time SDK setup (already done on this machine — documented for
reproducibility):

```
# command line tools 13114758 → %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest
licenses accepted via: sdkmanager --licenses   (with JAVA_HOME pinned to a JDK ≥ 17)
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
```

Used here: Gradle **9.1.0**, AGP **com.android.application 9.0.0-alpha09**
(AGP 9's **built-in Kotlin**, stdlib 2.2.10 — the standalone
`org.jetbrains.kotlin.android` plugin is REJECTED by AGP 9 and must stay out
of the build files), Gradle daemon JVM jdk-27 (system default). `local.properties`
carries `sdk.dir=C:/Users/xxspokiixx/AppData/Local/Android/Sdk`. The gradle
distribution itself lives outside the repo at
`%LOCALAPPDATA%\Android\gradle-dist\gradle-9.1.0` (the wrapper in this
directory re-downloads it when invoked elsewhere).

Build & install:

```
cd android-test
node prepare-android-assets.mjs          # stage assets/omb (+ jniLibs runtime when built)
.\gradlew :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

`assembleDebug` re-runs from cache: fresh `prepare` output changes assets, so
the merge task re-runs incrementally.

## Staging + smoke verification (Windows side)

`smoke-bundle.mjs` proves the exact bytes the APK will carry before any phone
is involved: it boots `assets/omb/server/index.js` with the boot-env contract
(`OMB_PORT`, `OMB_STATIC_DIR`, `OMB_DATA_DIR`, `HOME`, no `OMB_DESKTOP_PARENT`),
seeds the same config.json shape the Kotlin service writes, then walks
health → environment → pairing mint → pair (Set-Cookie) → session check →
static UI → first-run starter bot → one fixture engine turn.

```
node smoke-bundle.mjs
```

Expected output ends with `PASS fixture engine reply within 60 s`; every step
prints its result and leaves the log tail in the temp dir on failure.
Windows-only divergences the script carries (documented, they do not affect
the phone):

- node.exe lives in `C:\Program Files\...`, whose space would break the cli
  tokenizer; the smoke first tries the 8.3 short name, else copies node into
  its temp root. The phone's `/data/user/0/…` path has no spaces.
- Parent env vars (`OMB_*`, `FAKE_*`) are stripped like the phone's cleared
  environment, but base platform vars (`PATH`, `SystemRoot`) stay.

Build status on this machine: `:app:assembleDebug` green, then a repeat run
with every task `UP-TO-DATE` (incremental verified). APK at
`app/build/outputs/apk/debug/app-debug.apk` (about 1.4 MB shell before
staging; assets add ~54 MB and the node runtime adds ~70+ MB). Only warnings
seen: framework deprecations for icon-less `Notification.Builder.addAction`
and `window.statusBarColor`, accepted for this test build.

`adb devices` showed **no device attached** during creation of this test
shell, so nothing was installed from here; on-device verification happens
later when a phone is connected.

## On-device findings (2026-10-23)

Verified on hardware (Samsung SM-P610, Android 16, arm64): the embedded
runtime executes (`libnodeexec.so --version`), the server boots, listens on
`127.0.0.1:8799`, and the loopback contract passes on-device: health,
environment descriptor (`platform: "android"`), pairing mint + pair
(admin+client cookie), session verify, static UI served. See the plan doc's
execution status for the run log.

Two platform facts surfaced, both fixed in repo code (uncommitted, test lane):

- **Android denies `link(2)` in the app's own data directory** (EACCES on
  Samsung and RedMagic alike — AOSP sepolicy, not OEM hardening). Both
  atomic "write candidate + hard link" publishes that run during boot
  (`electron/data-dir-lease.mjs`, `server/environment.ts`) now share
  `electron/atomic-publish.mjs`, which falls back to an exists-check plus
  rename on android only; desktop keeps the link protocol (lease + env tests
  and the Windows smoke all stay green).
- The service could double-spawn the server when the activity re-triggered
  `onStartCommand` mid-boot (two `libnodeexec.so` processes seconds apart).
  `runBoot()` now holds an in-flight guard and will not re-spawn while a
  healthy boot is underway; a live-but-failed process is killed and rebooted.

Debugging notes: Samsung allows `adb logcat` (the E/nodejs stderr of the
spawned server is visible there); the RedMagic returned an empty logcat and
also blocks `/proc/uptime`. `adb shell run-as com.openmausbot.localtest …`
reaches the app's private files; a `files/nodebin` symlink to the current
`nativeLibraryDir/libnodeexec.so` must be recreated after each reinstall
(the `/data/app/~~…` path is randomized per install).

Open at the time of writing: the first-run starter bot never settled on
device — `/api/instances` reports the fixture CLI as
`unavailable: "… CLI not found"`, i.e. `readCliVersion`'s 8 s
`<cli> --version` probe loses on the phone, even though the same command
run by hand answers `2.1.232 (Claude Code)` with exit 0. Cold-start cost of
the runtime plus TS type-stripping is the suspect; measure a single spawn
before deciding between a longer android-only probe timeout and staging the
fixture engine as pre-stripped JS.

Both open items closed later the same day: the probe timeouts are now
android-aware (`CLI_PROBE_TIMEOUT_MS` in `server/procs.ts`, 45 s on
android), and the real root cause of "CLI not found" was `adb install -r`
randomizing `/data/app/~~…==` while `config.json` kept the old runtime path —
`ensureServerConfig` now repoints a stale `libnodeexec.so` cli head at the
current install (text-replace, user edits untouched). On-device,
`/api/instances` reports the fixture CLI `available`, version
`2.1.232 (Claude Code)`, authenticated.

## The phone's local desktop ("this computer", 2026-10-23)

Bots that pick **"this computer"** as their working destination now get a
real Linux environment on the phone — no root, no cloud:

- **Payload** (`android-test/runtime/android-arm64/linux/`, staged under
  `assets/omb/linux/`): Alpine 3.22.7 aarch64 rootfs (bash, coreutils,
  busybox, python 3.12, git, curl; 76 MB unpacked) + Termux's `proot`
  5.1.107.100, its `loader`, `libtalloc.so.2` and `libandroid-shmem.so`.
  Recipe + evidence: `linux/BUILD-NOTES.md` (includes the qemu fallback
  kept unstaged).
- **App side** (`NodeHostService.ensureLocalComputer`): extracts the payload
  per VERSION (linux payload is part of the asset hash), restores exec bits
  (`copyAssetDir` strips modes — the loader's missing x-bit was the real
  cause of every "Permission denied" in this lane), writes a
  `cua-connection.json` embedded descriptor into `OMB_USER_DATA`, and records
  a boot-time self-test in `files/linux/SELFTEST`.
- **Server side** (small, android-only): `HOSTS_WITH_LOCAL_CONTROL` includes
  android for explicit destination picks (never auto), and
  `readCuaConnection` decodes the android embedded descriptor (tests:
  `server/local-routing.test.ts`, `server/local-computer.test.ts`).
- **MCP** (`android-test/linux/android-local-computer.mjs`): stdio MCP
  exposing `bash`, `read_file`, `write_file`, `list_files` over
  `proot -R rootfs -b <workspace>:/work -w /work`, with proot's loader
  handling the guest's PT_INTERP (Android denies memfd exec).
- **targetSdk 28** (Termux precedent): required so app-data files can be
  exec'd at all (`untrusted_app_27` domain, confirmed via `ps -Z`); test-only,
  never store-distributed.

On-device evidence (Samsung SM-P610, Android 16): the app-domain self-test
reports `linux-ok / Linux … aarch64 GNU/Linux / Python 3.12.15`, and a
stdio MCP session lists the tools and runs a real guest command
(`MCP_GUEST_WORKS` + uname + python). Use it from a bot by setting the
turn's destination to "this computer" with a tool-capable engine.

### The browser (2026-10-24): Debian pivot, DNS, links

The guest moved from Alpine to **Debian bookworm arm64** (docker layer + apt
closure: chromium, python3, git, curl, fonts — 204 debs). Alpine's musl
chromium executed but died with SIGTRAP at headless startup; Debian's glibc
build works. Three Android facts shaped the tarball (all handled in the
builder, see `linux/BUILD-NOTES.md`): toybox tar refuses absolute-target
symlinks, `link(2)` is denied so tar hard links can never extract, and the
docker layer's `/bin`+`/lib` need compat links to the real `/usr` paths.

- **Browser exec**: `OMB_CHROME_PATH` names `omb-guest-chromium` (NDK r30
  wrapper) which re-execs the harness's Chrome argv through proot with the
  identity bind, `/dev/shm`, and `XDG_RUNTIME_DIR`; `OMB_BROWSER_SANDBOX=0`
  adds `--no-sandbox`. `features.browser` is seeded true and was flipped on in
  the existing device config through `PATCH /api/config`.
- **DNS**: the service rewrites `rootfs/etc/resolv.conf` every boot from the
  active network's resolvers (ConnectivityManager) plus public fallbacks —
  the guest never shipped one and Android has no host file for proot to bind.
  On-device: `curl https://example.com` → 200.
- **Verified**: `--dump-dom https://example.com` returns the fully rendered
  page from Chromium 156 inside the phone; the app-domain self-test runs
  bash/uname/python3; `PATCH /api/config` flipped `features.browser` true.
- **Links in the app UI** now open in the system browser
  (`shouldOverrideUrlLoading` no longer blocks them).

Final acceptance (user-run): open a bot's Browser destination and ask it to
browse — the model's browsing turns drive the same chromium.

### Device apps control (2026-10-25): apps without Composio

Bots can now drive the device's **own installed apps** through a granted
AccessibilityService — no Composio, no cloud, no adb:

- `DeviceAppsService.kt` — "OpenMausBot app control" in system Accessibility
  settings. Once granted it listens on **loopback TCP 127.0.0.1:8798** (a
  filesystem unix socket proved invisible across this device's mount views
  for legacy-target services) and serves: launchable-app listing, app
  launch by human name, the live window's accessibility tree (250-node cap,
  the desktop proxy's line format), taps (by coordinates or visible text),
  typing into the focused field, swipes, and global keys (back/home/recents).
  Re-binds are guarded so a second `onServiceConnected` cannot orphan the
  first server (the EADDRINUSE lesson).
- `android-test/linux/android-device-phone.mjs` — an on-device phone MCP with
  **the same tool names, schemas and result strings as the desktop's adb
  phone proxy** (`server/drivers/phone-proxy.ts`), including the per-turn
  phone claim protocol; unreachable service answers with precise grant
  steps. `phoneIntegration()` (server/index.ts) swaps the adb proxy for it
  on android when the staged file exists.
- Verified on-device over stdio: `status` → granted; `list_apps` → finds
  Settings; `open_app("settings")` → opens; `read_screen` → the live
  window's tree; `press back` → works.
- Grant UX: after each app reinstall Android resets the grant — re-enable
  "OpenMausBot app control" in Accessibility settings. adb grants
  (`settings put secure enabled_accessibility_services`) work for testing
  but the Settings-UI grant is the durable path on the user's devices.

### App sign-ins via the bot's own browser (2026-10-25): the no-Composio path

Bots connect to apps (Slack, Gmail, anything with a web login) by signing
into them **in the bot's own browser**, whose profile persists between
turns — the same model as desktop, no connector service involved. Three
blockers were hiding it on the phone:

1. **Engine kind**: OMB's default browser engine is `agent-browser`, which
   publishes no android-arm64 build, so the panel reported the browser
   unavailable. `config.browserEngine.engine` is now `"chrome"` — OMB's own
   CDP chrome driver — flipped on the existing device via `PATCH
   /api/config` and seeded for fresh installs.
2. **Env allowlist**: `browserRuntimeEnv` passes only an allowlist to the
   browser process; `OMB_ANDROID_LINUX_DIR` was scrubbed and the
   `omb-guest-chromium` wrapper exited 127 ("Chrome closed its DevTools
   pipe before answering"). The variable joined `HOST_ENV`, and the
   wrapper also gained a build-time fallback (the app's files dir is
   stable across installs).
3. With both fixed, the server's launch handshake completes: the engine
   status reads `"kind":"engine" … "Chromium 156 (named by
   OMB_CHROME_PATH)"` — the launcher's pipe-based CDP (`Browser.getVersion`
   over fds 3/4) answered through proot, after which the Browser panel's
   v2 WebSocket stream can show and drive the bot's chromium by touch.

### Rebrand (2026-10-25): the app is SpokyBot

The shipped app presents itself as **SpokyBot** everywhere, while the
checkout it stages from keeps its own product name — the rebrand is a
staging-time transform, not a source change:

- `prepare-android-assets.mjs` rewrites the staged `omb/` tree after
  copying: every "OpenMausBot"/"MausBot" in the server bundle, UI chunks,
  engine files and skills becomes "SpokyBot" (overridable with
  `OMB_TEST_BRAND`; source maps are skipped). Case-sensitive, so the
  technical, lowercase identifiers — `/.well-known/openmausbot`, the
  `omb_*` cookies, `openmausbot-server.lease` — never match and the
  protocol keeps working.
- The shell follows: launcher label, boot screen, notifications and the
  accessibility service all say SpokyBot (`strings.xml` + the manifest now
  references `@string/app_label`), the WebView user agent is `SpokyBot/1.0`,
  and a fresh install seeds the fixture engine as "SpokyBot (fixture)".
- Deliberately untouched: the person's own data (bot names — including a
  bot someone named "MausBot" — instance display names in an existing
  config, threads, logins) and the internal package id
  `com.openmausbot.localtest` (renaming it would break the baked paths,
  the accessibility grant and every wrapper).
- Verified on-device: `/api/brand` answers `{"name":"SpokyBot"}`, the
  served page title is SpokyBot, `aapt` reports `application-label:
  'SpokyBot'`, and the staged bundles hold 0 "OpenMausBot" while the
  lowercase protocol strings remain intact.

### OpenCode login → models (2026-10-25): the no-API-key engine lane

The built-in OpenCode engine (`opencodeGo` — Settings → Engines) now works on
the phone: the opencode CLI (npm `opencode-linux-arm64` 1.19.4, 211 MB, glibc)
ships inside the guest rootfs, and the driver's android default cli is the
proot chain (identity bind + a writable `/tmp`, whose absence Bun reports
first). Five phone-side facts had to line up:

1. **The instance**: OMB hides `opencodeGo` from configs that define their
   own instances; the app inserts `{"driver":"opencodeGo"}` into
   `config.json` when missing (text surgery like the cli repair; the
   top-level opencodeGo *key section* shares the name, so the guard matches
   the instance's `"driver"` specifically). Fresh installs seed it.
2. **The key at boot**: the server mirrors `opencodeGo.apiKey` →
   `OPENCODE_API_KEY` only when settings are PATCHed; a restarted server
   would lose it. The service reads the key from config.json at boot and
   exports it in the server env (never logged).
3. **The proot contract server-side**: chains spawned BY the server (not
   just the MCP scripts) need `LD_LIBRARY_PATH` (proot's libtalloc),
   `PROOT_TMP_DIR` (Termux's build defaults to its own /data path, which
   the app cannot write), `PROOT_NO_SECCOMP`,
   `PROOT_ASSUME_MEMFD_UNSUPPORTED` and `PROOT_LOADER` — all exported from
   the service env.
4. **`ca-certificates`**: trixie's curl dropped it from Depends into
   Recommends, and `dpkg-deb -x` runs no maintainer scripts — the builder
   now both includes the package and assembles `ca-certificates.crt` from
   the 148 shipped CAs the way `update-ca-certificates` would.
5. Verified live: the engine probes **available, version 1.19.4**, catalog
   **112 models** (Zen/Go), default `opencode/beam-free`.

A bot picks any of them in the model picker; turns run through the guest
CLI against the OpenCode gateway.

### Notifications (2026-10-25): bot messages reach the system tray

The web UI posts message notifications through the web Notification API,
which a plain WebView never grants — on the phone they silently never
fired. `src/lib/notify.ts` now falls back to the `ombAndroidCaps` bridge
when the web permission is missing, and MainActivity posts a real system
notification (channel "Bot messages", tap opens the app, POST_NOTIFICATIONS
requested on first launch on Android 13+). The per-bot Notifications toggle
and the finished-notifications preference keep gating the same call, so
every existing setting behaves identically. Verified live in the WebView:
`ombAndroidCaps.notify` reports `typeof function` on page load.

The flow for a person: bot settings → Browser → **Add login** → the
streamed bot browser opens the site → sign in by touch → the login lands
in the bot's persistent profile (`SignedInSites` lists it) → every later
turn browses with that session.

### Making "This PC" selectable in the WebView (2026-10-23)

The web UI gates the local-computer choice on *desktop capabilities*, which
come from the Electron preload's `window.ogb` — absent in any plain
WebView, so the option rendered disabled ("desktop app required") even
though the server side was fully ready. The test shell now injects an
`ombAndroidCaps` JavaScript interface into the WebView
(`MainActivity.attachWebView`), and `src/lib/desktop.ts` synthesizes the
capabilities payload from it (host: "Tablet", local computer ready,
desktop-only features absent). On-device proof: the bridge answers at page
load (logcat `OMBTest: caps bridge:{"host":…`), and the bot's
**Computer → "Where {bot} works"** row offers **This PC** enabled — picking
it makes every turn of that bot mount the phone's Linux environment.

A second hidden blocker surfaced on the first real turn: the embedded
node build ships **no `process.getuid`**, so the descriptor's ownership
validation (`uid = process.getuid?.() ?? -1`) rejected every descriptor
("CUA Driver is not ready"). `descriptorUid()` in
`server/local-computer.ts` now falls back to the uid of the process's own
home directory — the same identity in the app's single-user sandbox — and
the on-device probe reads the full connection back. A third blocker
followed: the descriptor's `mcp` contract tag reached the node runtime as
its entry-script argument ("MCP server exited before the session
closed"); android connections now strip it in `gatedLocalComputer`
(desktop CUA unchanged). Final acceptance, run by the user: a real turn
on their own bot (their provider, configured via the tablet's settings
UI) with destination "this computer" executed `uname -a` and
`python3 --version` in the phone's Linux and answered in the chat with
the tablet's real kernel (4.14.356, aarch64) and Python 3.12.15.

## Known limits of this test shell

- No microphone bridge, no downloads handling, no app-link intents —
  production-only concerns.
- `onShowFileChooser` forwards to ACTION_GET_CONTENT-based
  `createIntent()`; camera capture choice variants are not wired.
- Back handling is native `goBack()` only (the web UI closes its own
  drawers first when driven by touch; no postMessage bridge yet, as
  planned for the production shell).
- `process.destroy()` kills the spawned node; worker children it spawned
  may outlive it briefly on some devices — acceptable for a test build.
