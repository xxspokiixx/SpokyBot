// Stages the on-device bundle into android-test/app/src/main/assets/omb from
// this repo's build outputs:
//   dist-server/**  -> omb/server/**   (self-contained harness bundle)
//   dist/**         -> omb/ui/**       (web UI, served via OMB_STATIC_DIR)
//   server/testing/<fixture-engine import closure> -> omb/engine/**
//   skills/**       -> omb/skills/**   (bundled skills library)
//   VERSION stamp   (content hash marker for idempotent extraction)
// Also stages the cross-compiled node runtime when it exists:
//   runtime/android-arm64/libnodeexec.so -> app/src/main/jniLibs/arm64-v8a/
// Rebuilds the target from scratch each run.
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { extract } from "tar";

const ROOT = join(import.meta.dirname, "..");
const distServer = join(ROOT, "dist-server");
const distUi = join(ROOT, "dist");
const target = join(ROOT, "android-test", "app", "src", "main", "assets");
const omb = join(target, "omb");
const runtimeSource = join(ROOT, "android-test", "runtime", "android-arm64", "libnodeexec.so");
const jniLib = join(ROOT, "android-test", "app", "src", "main", "jniLibs", "arm64-v8a", "libnodeexec.so");

if (!existsSync(join(distServer, "index.js"))) {
  fail("dist-server/index.js missing — run: corepack pnpm run build:server");
}
if (!existsSync(join(distUi, "index.html"))) {
  fail("dist/index.html missing — run: corepack pnpm exec vite build");
}
warnIfStale(distUi, "index.html", ["src", "index.html", "package.json"]);

rmSync(omb, { recursive: true, force: true });
mkdirSync(omb, { recursive: true });
cpSync(distServer, join(omb, "server"), { recursive: true });
// Copy dist UI but exclude offline-rootfs build artifacts (they're huge and not needed on device)
  const EXCLUDE_DIRS = new Set(["offline-rootfs", "offline-rootfs-arm64"]);
  function copyDirFiltered(src, dest) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirFiltered(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }
  copyDirFiltered(distUi, join(omb, "ui"));
mkdirSync(join(omb, "engine"), { recursive: true });
for (const name of fakeCliClosure(join(ROOT, "server", "testing"))) {
  copyFileSync(join(ROOT, "server", "testing", name), join(omb, "engine", name));
}

if (existsSync(join(ROOT, "skills"))) cpSync(join(ROOT, "skills"), join(omb, "skills"), { recursive: true });

// Rebrand the phone's staged bundle: the shipped app presents itself as
// SpokyBot while the checkout it stages from keeps its own product name.
// Case-sensitive: technical, lowercase protocol identifiers
// (/.well-known/openmausbot, omb_* cookies, lease file names) never match.
// Source maps are skipped: they are dev-only and never rendered.
const BRAND_NAME = process.env.OMB_TEST_BRAND || "SpokyBot";
const REBRAND_EXTENSIONS = /\.(js|mjs|cjs|ts|html|css|json|md|txt)$/i;
async function writeWithRetry(file, data, retries = 5, delay = 100) {
  for (let i = 0; i < retries; i++) {
    try {
      writeFileSync(file, data);
      return;
    } catch (e) {
      if (i === retries - 1) throw e;
      // Windows file locking (ERROR_LOCK_VIOLATION = -4094, ERROR_SHARING_VIOLATION = -4091)
      // Also catch EPERM, EACCES, EBUSY
      const isLockError = e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY' ||
        e.errno === -4094 || e.errno === -4091 || e.message?.includes('UNKNOWN');
      if (isLockError) {
        const { setTimeout } = await import("node:timers/promises");
        await setTimeout(delay * (i + 1)); // exponential backoff
        continue;
      }
      throw e;
    }
  }
}
async function rebrandTree(dir) {
  let touched = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      touched += await rebrandTree(full);
      continue;
    }
    if (!REBRAND_EXTENSIONS.test(entry.name)) continue;
    const text = readFileSync(full, "utf8");
    const renamed = text.replaceAll("OpenMausBot", BRAND_NAME).replaceAll("MausBot", BRAND_NAME);
    if (renamed !== text) {
      await writeWithRetry(full, renamed);
      touched += 1;
    }
  }
  return touched;
}
const rebrandedFiles = await rebrandTree(omb);
console.error(`prepare: rebranded ${rebrandedFiles} staged files to ${BRAND_NAME}`);

// The phone's local desktop: proot + Alpine rootfs + qemu (runtime/android-arm64/linux/)
// and the MCP server the harness gate launches (android-test/linux/).
const linuxRuntime = join(ROOT, "android-test", "runtime", "android-arm64", "linux");
const linuxMcp = join(ROOT, "android-test", "linux", "android-local-computer.mjs");
if (existsSync(join(linuxRuntime, "rootfs.tar.gz"))) {
  const linuxTarget = join(omb, "linux");
  mkdirSync(linuxTarget, { recursive: true });
  // aapt transparently decompresses *.gz assets (a 450 MB tarball became a
  // 1.25 GB APK entry); an opaque extension keeps the compressed bytes.
  for (const name of ["rootfs.tar.gz", "proot", "loader", "libtalloc.so.2", "libandroid-shmem.so", "omb-guest-chromium", "setup-graphical-desktop.sh"]) {
    const source = join(linuxRuntime, name);
    const target = name === "rootfs.tar.gz" ? join(linuxTarget, "rootfs.blob") : join(linuxTarget, name);
    if (existsSync(source)) {
      copyFileSync(source, target);
    }
  }
  // Copy debs folder for graphical desktop (no network required on device)
  const debsSource = join(linuxRuntime, "debs");
  const debsTarget = join(linuxTarget, "debs");
  if (existsSync(debsSource)) {
    cpSync(debsSource, debsTarget, { recursive: true });
  }
  copyFileSync(linuxMcp, join(linuxTarget, "android-local-computer.mjs"));
  copyFileSync(join(ROOT, "android-test", "linux", "android-device-phone.mjs"), join(linuxTarget, "android-device-phone.mjs"));
}

// Stage OpenCode standalone binary for linux-arm64 (pre-installed in rootfs)
const opencodeUrl = "https://github.com/anomalyco/opencode/releases/download/v1.19.4/opencode-linux-arm64.tar.gz";
const opencodeTarget = join(omb, "linux", "opencode");
if (!existsSync(opencodeTarget)) {
  try {
    const response = await fetch(opencodeUrl);
    if (response.ok) {
      const { createGunzip } = await import("node:zlib");
      const { createWriteStream } = await import("node:fs");
      const { pipeline } = await import("node:stream/promises");
      const { extract } = await import("tar");
      const tmpDir = join(ROOT, ".tmp-opencode");
      mkdirSync(tmpDir, { recursive: true });
      const tmpFile = join(tmpDir, "opencode.tar.gz");
      await pipeline(response.body, createWriteStream(tmpFile));
      await pipeline(
        createReadStream(tmpFile),
        createGunzip(),
        extract({ cwd: tmpDir })
      );
      const binary = join(tmpDir, "opencode");
      if (existsSync(binary)) {
        copyFileSync(binary, opencodeTarget);
        chmodSync(opencodeTarget, 0o755);
        console.error("prepare: staged OpenCode standalone binary");
      }
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn("prepare: failed to stage OpenCode binary:", e instanceof Error ? e.message : String(e));
  }
}

// Stage SSH key from ~/.ssh for VPS connections (user@host format)
const sshDir = join(homedir(), ".ssh");
const sshKeyTarget = join(omb, "ssh");
if (existsSync(sshDir)) {
  mkdirSync(sshKeyTarget, { recursive: true });
  const keyFiles = readdirSync(sshDir).filter(name =>
    name === "id_rsa" || name === "id_ed25519" || name === "id_ecdsa" || name === "id_dsa" || name.endsWith(".pub")
  );
  for (const keyFile of keyFiles) {
    const source = join(sshDir, keyFile);
    const target = join(sshKeyTarget, keyFile);
    try {
      copyFileSync(source, target);
      chmodSync(target, 0o600);
    } catch (e) {
      console.warn(`prepare: failed to copy SSH key ${keyFile}:`, e instanceof Error ? e.message : String(e));
    }
  }
  if (keyFiles.length > 0) {
    console.error(`prepare: staged ${keyFiles.length} SSH key(s) for VPS connections`);
  }
}

const serverHash = hash8(join(distServer, "index.js"));
const uiHash = hashTree(distUi);;
// Names+sizes of the linux payload (recursive; content hashes of a 29 MB tarball per
// run would cost seconds for no extra safety — a payload that changes almost always
// changes a size).
const linuxStamp = existsSync(join(omb, "linux"))
  ? (function walk(dir, prefix) {
      return readdirSync(dir)
        .map((name) => {
          const full = join(dir, name);
          return statSync(full).isDirectory()
            ? walk(full, `${prefix}${name}/`)
            : `${prefix}${name}:${statSync(full).size}`;
        })
        .sort()
        .join("|");
    })(join(omb, "linux"), "")
  : "";
const linuxHash = linuxStamp ? createHash("sha256").update(linuxStamp).digest("hex").slice(0, 8) : "none";
const version = `omb-test-${pkgVersion()}-server${serverHash}-ui${uiHash}-linux${linuxHash}`;
writeWithNewline(join(omb, "VERSION"), version);

let runtimeStaged = false;
if (existsSync(runtimeSource)) {
  mkdirSync(dirname(jniLib), { recursive: true });
  copyFileSync(runtimeSource, jniLib);
  runtimeStaged = true;
}

report();

function fail(message) {
  console.error(`prepare: ${message}`);
  process.exit(1);
}

function pkgVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

function hash8(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
}
function hashTree(dir) {
  const files = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      files.push(full);
    }
  }
  walk(dir);
  files.sort();
  const h = createHash("sha256");
  for (const file of files) h.update(readFileSync(file));
  return h.digest("hex").slice(0, 8);
}

function writeWithNewline(file, text) {
  writeFileSync(file, `${text}\n`);
}

/** dist is derived state; a newer input than its output means the staged UI
 * would silently look wrong on the phone. */
function warnIfStale(targetDir, outputName, inputs) {
  const outputTime = statSync(join(targetDir, outputName)).mtimeMs;
  for (const input of inputs) {
    const path = join(ROOT, input);
    let newest = 0;
    try {
      newest = newestMtime(path);
    } catch {
      continue;
    }
    if (newest > outputTime) {
      console.warn(`prepare: WARNING: ${input} is newer than dist/${outputName} — stage a fresh build or the phone UI may miss recent web changes`);
    }
  }
}

function newestMtime(path) {
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  return (readdirSync(path).reduce((acc, name) => Math.max(acc, newestMtime(join(path, name))), 0));
}

/** fake-claude-cli.ts runs as its own process and reaches its siblings through
 * relative imports, so every file it (transitively) imports must be staged. */
function fakeCliClosure(testingDir) {
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    let text = "";
    try {
      text = readFileSync(join(testingDir, name), "utf8");
    } catch {
      return;
    }
    for (const match of text.matchAll(/(?:from|import)\s+[`"']\.\/([^`"']+)/g)) walk(match[1]);
  };
  walk("fake-claude-cli.ts");
  return [...seen].sort();
}

function report() {
  const rows = [["server", join(omb, "server")], ["ui", join(omb, "ui")], ["engine", join(omb, "engine")], ["skills", join(omb, "skills")]].filter(([, dir]) => existsSync(dir));
  let total = 0;
  const lines = runtimeStaged ? ["  runtime libnodeexec.so staged into app/src/main/jniLibs"] : ["  runtime libnodeexec.so NOT yet built — android-test/runtime/android-arm64/…"];
  for (const [name, dir] of rows) {
    const bytes = dirBytes(dir);
    total += bytes;
    lines.push(`  ${name.padEnd(6)} ${fmt(bytes)}  ${fileCount(dir)} files`);
  }
  console.log(`prepare: staged ${target}`);
  console.log(lines.join("\n"));
  console.log(`  total  ${fmt(total)}   VERSION: ${version}`);
}

function dirBytes(dir) {
  const walk = (path) => (statSync(path).isDirectory()
    ? readdirSync(path).reduce((acc, name) => acc + walk(join(path, name)), 0)
    : statSync(path).size);
  return walk(dir);
}

function fileCount(dir) {
  const walk = (path) => (statSync(path).isDirectory()
    ? readdirSync(path).reduce((acc, name) => acc + walk(join(path, name)), 0)
    : 1);
  return walk(dir);
}

function fmt(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} kB`;
}
