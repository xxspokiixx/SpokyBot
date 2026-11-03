# BUILD-NOTES — Node.js v24.20.0 for Android arm64 (bionic, API 26), built entirely locally

**Status: BUILT (success).** Produced via vanilla Node.js `android-configure` + two minimal gyp/source patches, on this Windows host's WSL2 Ubuntu distro. No git commits/pushes anywhere; all work stayed inside WSL `$HOME` (`/home/xxspokiixx/nodebuild/...`); only outputs copied out to `android-test/runtime/android-arm64/`.

## Deliverables (this folder)

| File | Size (bytes) | sha256 |
|---|---|---|
| `libnodeexec.so` | 123,342,736 | `e76f394fd6638827e0876036784568a22cfe64493452e4b2a9978ef9a0d89d03` |
| `node-nonpackaged` | 123,342,736 | `e76f394fd6638827e0876036784568a22cfe64493452e4b2a9978ef9a0d89d03` (identical copy of `out/Release/node`, exec bit set) |
| `build-evidence/` | — | readelf dumps, logs, config.gypi, patch files + originals |

`libnodeexec.so` is a regular PIE ELF executable renamed for APK packaging (Android only stages files matching `lib*.so` under `nativeLibraryDir`; the .exec bit was removed from this copy). `node-nonpackaged` is byte-identical with the exec bit for out-of-APK testing (e.g. push to app-private dir).

- Node source: `node-v24.20.0.tar.xz` from `https://nodejs.org/dist/` (53.66 MB)
- Host: WSL2 Linux — Ubuntu 26.04.1 LTS, kernel `6.18.40.1-microsoft-standard-WSL2`, x86_64, 20 logical cores, 7.6 GiB RAM (+ 8 GiB swapfile added during build, see Failures)
- Target: Android arm64 (bionic), min API 26, 16 KB page-size compatible

## Toolchain

| Component | Version / path |
|---|---|
| Android NDK | **r30** — `Pkg.Revision 30.0.16248370`, download `android-ndk-r30-linux.zip` (738,633,529 bytes, file size matches the dl.google.com listing on developer.android.com/ndk/downloads), unzipped to `~/nodebuild/ndk/android-ndk-r30` |
| Target C/C++ | NDK clang **21.0.0** via wrapper `toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang{,++}` |
| Host C/C++ | `/usr/bin/gcc` + `/usr/bin/g++` (Ubuntu 15.2.0), GNU Make 4.4.1, Python 3.14.4 (accepted by Node's configure: python 3.9–3.14 allowed) |

## Exact build recipe (in WSL, `$HOME/nodebuild`)

```bash
# 1. packages (sudo cannot be used passwordlessly here — used `wsl -u root -e bash -lc` for this step)
apt-get update && apt-get install -y build-essential ca-certificates unzip   # curl/xz already present

# 2. env (must be exported for BOTH configure and make; gyp makefile uses LDFLAGS.target ?= $(LDFLAGS))
export CC_host=/usr/bin/gcc
export CXX_host=/usr/bin/g++
export LDFLAGS='-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 -static-libstdc++'
export NDKP=$HOME/nodebuild/ndk/android-ndk-r30

# 3. configure (vanilla Node v24.20.0 script; python3 bootstraps android_configure.py)
./android-configure $NDKP 26 arm64
# internally sets CC/CXX to aarch64-linux-android26-clang{,++}, GYP_DEFINES
# (target_arch=arm64, v8_target_arch=arm64, android_target_arch=arm64, host_os=linux, OS=android,
#  android_ndk_path=$NDKP) and runs: ./configure --dest-cpu=arm64 --dest-os=android --openssl-no-asm --cross-compiling

# 4. build
make -C out BUILDTYPE=Release -j8 node      # 'node' target only; see Failures#4 for why not plain `all`
```

Environment notes:
- `CC_host`/`CXX_host` **must be set explicitly**, otherwise gyp silently binds the HOST toolset (`CC.host`/`CXX.host`) to the aarch64-android clang wrapper taken from `$CC`, and cross build tools (mksnapshot, ICU codegen, torque) would be built for Android and could not run on the host. With the explicit pinning the generated `out/Makefile` contains `CC.host ?= /usr/bin/gcc`, `CXX.host ?= /usr/bin/g++`, `LINK.host ?= $(CXX.host)`.
- `-static-libstdc++` (NDK clang + static libc++ runtime) worked as intended: no `libc++_shared.so` in DT_NEEDED.
- The Node configure phase disables node snapshot + node code cache automatically when `--cross-compiling` (observed in `config.gypi`: `node_use_node_snapshot:false`, `node_use_node_code_cache:false`) — expected for cross builds; slightly later JS startup, no functional loss. Also `--openssl-no-asm` is hardcoded by `android_configure.py` for Android (portable crypto, slower).

## Validation (llvm-readelf on `out/Release/node`)

- ELF64, **Machine: AArch64**, **Type: DYN** + dynamic `FLAGS_1 NOW PIE` ⇒ PIE executable; interpreter `/system/bin/linker64`; `.note.android.ident` present (bionic ABI tag, API 26).
- Full output in `build-evidence/readelf-h.txt`, `-d`, `-l`, `-n`.

DT_NEEDED (only Android system libs — no libc++_shared.so):

```
0x0000000000000001 (NEEDED)  Shared library: [libm.so]
0x0000000000000001 (NEEDED)  Shared library: [libdl.so]
0x0000000000000001 (NEEDED)  Shared library: [liblog.so]
0x0000000000000001 (NEEDED)  Shared library: [libc.so]
```

LOAD segments (all aligned to **0x4000** = 16384 — 16 KB page compatible):

```
LOAD  0x000000  0x0000000000000000  0x5938540  R E  0x4000
LOAD  0x5938540 0x000000000593c540  0x136378/0x137ac0   RW  0x4000
LOAD  0x5a70000 0x0000000005a78000  0x028f80/0x05b6c0   RW  0x4000
GNU_RELRO present; BIND_NOWFLAGS (dynamic FLAGS: BIND_NOW, FLAGS_1: NOW PIE)
```

Binary size: **123,342,736 bytes (~117.6 MiB, unstripped Release)**.

## Patch record (all diffs in `build-evidence/`)

### Patch 1 — zlib cpu-features for Android (link failure: `undefined symbol: android_getCpuFeatures`)
- `deps/zlib/cpu_features.c` (Chromium-scraped zlib source, compiled with `ARMV8_OS_ANDROID` + `__ARM_NEON__` on this target) calls NDK's `android_getCpuFeatures()`, but nothing compiled the implementation. Chromium solves this by linking the NDK cpu-features source; v24.20.0 does not.
- Fix: copied `cpu-features.c`, `cpu-features.h`, `NOTICE` from NDK r30 `sources/android/cpufeatures/` into `deps/zlib/` (cpu-features.c sha256 `1b8a88eb7d3a5437d17e12475539398d3e1c5eef13d85941679841254af0a8f5`, header `f4989fabece7ea538e3c1272dca47f8a9a4423a87c79a1344a2611e884cb7319`), and patched `deps/zlib/zlib.gyp` to compile it only when `OS=="android"` (see `zlib-android-cpu-features.diff` + `zlib.gyp.orig`):

```diff
@@ -244,6 +244,9 @@
                 ['target_arch=="arm64"', {
                   'defines': [ 'INFLATE_CHUNK_READ_64LE' ],
                 }],
+                ['OS=="android"', {
+                  'sources': [ '<(ZLIB_ROOT)/cpu-features.c' ],
+                }],
               ],
             }],
```

### Patch 2 — v8.gyp arm64 wasm trap-handler sources for cross builds (host `mksnapshot` link failure: undefined `trap_handler::TryHandleSignal` / `RegisterDefaultTrapHandler` / `v8_internal_simulator_ProbeMemory`)
- In `tools/v8_gypfiles/v8.gyp`, the arm64 wasm-trap-handler source conditions excluded `OS=android`, so for an android cross build neither the target nor the host (x64 + arm64-simulator) toolset got `handler-inside-posix.cc` / `handler-outside-posix.cc` / `handler-outside-simulator.cc` — while WebAssembly is enabled, so the host mksnapshot objects reference those symbols.
- Fix (see `v8-android-traphandler-sim.diff` + `v8.gyp.orig`): add `android` to the three `OS in "..."` membership strings in the arm64 block:

```diff
-   ['...host_arch=="arm64"... and (OS in "linux mac ios openharmony")) or (...host_arch=="x64"... and (OS in "linux mac openharmony"))'
+   ['...host_arch=="arm64"... and (OS in "linux mac ios openharmony android")) or (...host_arch=="x64"... and (OS in "linux mac openharmony android"))'
-   ['...host_arch=="x64"... and (OS in "linux mac win openharmony")'   (2 occurrences: v8_base arm64 block + arm64 header set block)
+   ['...host_arch=="x64"... and (OS in "linux mac win openharmony android")'
```

- Runtime consequence of Note A: on the android arm64 target the header resolves `V8_TRAP_HANDLER_SUPPORTED=false`, so handlers compile to empty TUs (safe, dead code). On the host simulator build it resolves `V8_TRAP_HANDLER_VIA_SIMULATOR` + supported ⇒ mksnapshot links and runs normally.

### Note A — Node's shipped android trap-handler patch does not apply, and must not be applied
- `./android-configure patch` (which applies `android-patches/trap-handler.h.patch`) **failed**: `Hunk #1 FAILED at 18` (.rej created; original file untouched — the v24.20.0 V8 was already restructured).
- Upstream v24.20.0's `deps/v8/src/trap-handler/trap-handler.h` already contains the fix for nodejs/node#36287 semantics: every "supported" platform branch excludes `V8_OS_ANDROID`, and there is an explicit `#if V8_OS_ANDROID && V8_TRAP_HANDLER_SUPPORTED → #error` guard ("The V8 trap handler should not be enabled on Android"). Android arm64 target builds therefore keep the wasm trap handler disabled by design. No further action needed; both failed attempts are recorded in the logs (`build-evidence/trap-handler.h.patch`, `configure-1.log`).

## Failures encountered during the build (all resolved above)

| # | Duration | Failure | Root cause | Resolution |
|---|---|---|---|---|
| 1 | 160 s | `ld.lld: undefined symbol: android_getCpuFeatures` linking `openssl-cli` (zlib `cpu_features.o`) | NDK cpu-features impl not compiled | Patch 1 |
| 2 | 1447 s | aarch64 clang **Killed (Error 137)** compiling `icudt78_dat.o` | OOM: WSL2 had 7.6 GiB RAM; ICU data blob + 7 concurrent V8 C++ files exceeded it | Added 8 GiB swapfile (`wsl -u root`: fallocate/mkswap/swapon in `$HOME/nodebuild/swapfile`), kept `-j8` |
| 3 | 3398 s | host `mksnapshot` link fails: undefined `TryHandleSignal`/`RegisterDefaultTrapHandler`/`v8_internal_simulator_ProbeMemory` | Patch-relevant gyp conditions excluded android | Patch 2 |
| 4 | 32 s | `cctest` test target: `test_crypto_clienthello.cc:57: error: use of undeclared identifier 'aligned_alloc'` | `aligned_alloc` requires bionic API ≥ 28; we target API 26; **test-only target**, not the runtime | Dropped `all`, built `make -C out ... node` (node.target) instead of rebuilding cctest for the executable only |
| 5 | 16 s | — | builds of all deps+libs were already complete from runs 2–4 | SUCCESS: `out/Release/node` linked |

Total make wall time across runs (cumulative, iterative): 160 + 1447 + 3398 + 32 + 16 s ≈ **84 min**. Whole session (downloads, unzip, patches, configure×4, delivery) ≈ 110 min.

## Deviations / constraints to know when testing on device

- **No boot snapshot / code cache** (cross-compile default): first JS-eval latency is slightly higher than official desktop binaries.
- **OpenSSL without CPU asm** (`--openssl-no-asm`, hardcoded by android_configure.py): portable crypto, slower.
- **cctest and other node self-tests were not built** (API-26 build issue + not needed); `node` itself is complete.
- **npm/corepack**: `node_install_npm:true` in config, but no `make install` was run, so the binary alone does not contain an npm launcher outside its bundled modules — irrelevant for a TS-stripping server runtime.
- The build cannot be executed in WSL (host is x86_64). Property validation above is the acceptance for packaging; runtime validation (start, run the OpenMausBot server, `procfs` sanity) must be done on-device/emulator by the orchestrator.
- WSL entry detail: `sudo` requires a password (not available), package management done via `wsl -u root -e bash -lc '...'` (WSL's built-in passwordless root entry); normal build ran as the default user.

## Repro pointers

- Source tree kept at `~/nodebuild/src/node-v24.20.0` (patches applied in place; pristine copies of both patched files are in `build-evidence/` as `zlib.gyp.orig` and `v8.gyp.orig`).
- Full make logs: `~/nodebuild/logs/build.log` (63,893 lines, phases marked `BUILD_INLINE`→`BUILD5_EXIT=0`), also copied to `build-evidence/build.log`. Configure logs: `configure-1.log` (first bad host fallback), `configure-2.log` (with CC_host pinning), `configure4.log` = post-patch-2 regen (referenced in WSL logs dir; copies 1/2 in build-evidence).
- NDK zip: `~/nodebuild/android-ndk-r30-linux.zip`; Node tarball: `~/nodebuild/node-v24.20.0.tar.xz`.
