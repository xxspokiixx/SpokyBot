// An AI's own standalone build, installed without Node.js or npm. The release is pinned in code (URL, SHA-256, size,
// hosts, macOS signer), downloaded over HTTPS from those hosts only, verified before anything is unpacked, proven to
// start, and only then made current. Each version gets tools/standalone/<engine>/<version>/; current.json names the
// one on PATH, and the two newest stay so a process still running the previous one keeps its files.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import * as tar from "tar";

import { renameWithRetry, writeFileAtomic } from "./atomic.ts";
import { DATA_DIR, stripWorkspaceCredentialEnv } from "./config.ts";
import type { StandaloneAsset, StandaloneRelease } from "./contracts.ts";
import { augmentedPath, findCliCandidates, registerPathDir, resetPathCache } from "./env-path.ts";
import { extractZip, safeArchivePath } from "./zip-archive.ts";

const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_ZIP_MEMBERS = 10_000;
const RECORD = ".standalone-install.json";
const CURRENT = "current.json";
const DOWNLOAD_PREFIX = ".download-";
const STAGING_PREFIX = ".staging-";

const ENGINE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;
// No slash, and it cannot be "." or "..": the first character is a letter or digit.
const VERSION_NAME = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TEAM_ID = /^[A-Z0-9]{10}$/u;

export interface StandaloneInstalled {
  version: string;
  executablePath: string;
  binDir: string;
}

/** Runs /usr/bin/codesign with these arguments; `code` is its exit status, null when it could not run. */
export type CodesignRunner = (args: string[]) => Promise<{ code: number | null; output: string }>;

export interface StandaloneInstallOptions {
  baseDir?: string;
  /** Tests only: the build to pick, which also decides whether the macOS signature check runs. */
  platformKey?: string;
  fetchImpl?: typeof fetch;
  codesign?: CodesignRunner;
  timeoutMs?: number;
}

interface InstallRecord {
  engine: string;
  version: string;
  sha256: string;
  executable: string;
  installedAt: number;
}

interface CurrentPointer {
  version: string;
  executable: string;
  sha256: string;
}

class StandaloneInstallError extends Error {}

let muslHost: boolean | undefined;

/** Node's own report names the glibc it runs on; a Linux without one is musl (Alpine and friends). */
function linuxWithoutGlibc(): boolean {
  if (process.platform !== "linux") return false;
  if (muslHost === undefined) {
    try {
      const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
      muslHost = !header?.glibcVersionRuntime;
    } catch {
      muslHost = false;
    }
  }
  return muslHost;
}

export function standalonePlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl: boolean = linuxWithoutGlibc(),
): string {
  return `${platform}-${arch}${platform === "linux" && musl ? "-musl" : ""}`;
}

/** Only the build made for exactly this platform: a glibc build does not start on musl, nor the reverse. */
export function standaloneAssetFor(release: StandaloneRelease | undefined, key: string = standalonePlatformKey()): StandaloneAsset | null {
  const assets = release?.assets as Record<string, StandaloneAsset | undefined> | undefined;
  return assets && Object.hasOwn(assets, key) ? assets[key] ?? null : null;
}

export function standaloneRoot(baseDir = DATA_DIR): string {
  return join(baseDir, "tools", "standalone");
}

export function standaloneEngineDir(engine: string, baseDir = DATA_DIR): string {
  return join(standaloneRoot(baseDir), engine);
}

// Versions made current while this server runs may have live processes; only a later server prunes them.
const activeVersions = new Set<string>();
const running = new Map<string, Promise<StandaloneInstalled>>();

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function executableIn(versionDir: string, executable: string): string {
  return join(versionDir, ...executable.split("/"));
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readRecord(versionDir: string): InstallRecord | null {
  const record = readJson(join(versionDir, RECORD)) as Partial<InstallRecord> | null;
  if (!record || typeof record.sha256 !== "string" || typeof record.executable !== "string" || !safeArchivePath(record.executable)) return null;
  return record as InstallRecord;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The version current.json names, when it is a complete install inside this engine's folder. */
function readCurrent(engineDir: string): StandaloneInstalled | null {
  const pointer = readJson(join(engineDir, CURRENT)) as Partial<CurrentPointer> | null;
  if (!pointer || typeof pointer.version !== "string" || !VERSION_NAME.test(pointer.version)) return null;
  const versionDir = join(engineDir, pointer.version);
  // The record's executable is a checked relative path, and the pointer must name the same one.
  const record = readRecord(versionDir);
  if (!record || record.sha256 !== pointer.sha256 || record.executable !== pointer.executable) return null;
  const executablePath = executableIn(versionDir, pointer.executable);
  if (!isFile(executablePath)) return null;
  return { version: pointer.version, executablePath, binDir: dirname(executablePath) };
}

/** At boot: each engine's current version goes on PATH ahead of everything else, like the app's npm folder. */
export function registerStandaloneBinDirs(baseDir = DATA_DIR): void {
  let engines: string[];
  try {
    engines = readdirSync(standaloneRoot(baseDir)).filter((name) => ENGINE_NAME.test(name));
  } catch {
    return;
  }
  for (const engine of engines) {
    const engineDir = standaloneEngineDir(engine, baseDir);
    const current = readCurrent(engineDir);
    if (!current) continue;
    activeVersions.add(join(engineDir, current.version));
    registerPathDir(current.binDir);
  }
}

/** The release's run settings when `cli` resolves to the app's own copy; a copy the person installed gets none. */
export function standaloneRunEnv(release: StandaloneRelease | undefined, cli: string, baseDir = DATA_DIR): Record<string, string> {
  if (!release?.runEnv) return {};
  const resolved = findCliCandidates(cli)[0];
  return resolved && inside(standaloneEngineDir(release.engine, baseDir), resolve(resolved)) ? { ...release.runEnv } : {};
}

function checkRelease(release: StandaloneRelease, asset: StandaloneAsset): void {
  if (
    !ENGINE_NAME.test(release.engine) || !VERSION_NAME.test(release.version) || !SHA256.test(asset.sha256)
    || !safeArchivePath(asset.executable) || !Number.isSafeInteger(asset.approxBytes) || asset.approxBytes <= 0
    || (release.macTeamId !== undefined && !TEAM_ID.test(release.macTeamId))
  ) throw new StandaloneInstallError(`${release.name}'s install details are invalid. Nothing was downloaded.`);
}

function trustedUrl(url: URL, hosts: readonly string[]): boolean {
  return url.protocol === "https:" && !url.username && !url.password && (url.port === "" || url.port === "443") && hosts.includes(url.hostname);
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
    if (bytesWritten <= 0) throw new Error("The download could not be written to disk.");
    offset += bytesWritten;
  }
}

/** Streams the asset to `destination` while hashing it; every hop must be HTTPS to a release host. */
async function download(release: StandaloneRelease, asset: StandaloneAsset, destination: string, options: StandaloneInstallOptions): Promise<void> {
  const name = release.name;
  const cap = asset.approxBytes * 2;
  const tooLarge = () => new StandaloneInstallError(`The ${name} download was larger than expected, so it was stopped. Nothing was installed.`);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  timer.unref?.();
  try {
    let url = new URL(asset.url);
    let response: Response;
    for (let hop = 0; ; hop += 1) {
      if (!trustedUrl(url, release.hosts)) {
        throw new StandaloneInstallError(`The ${name} download did not come from its official site, so it was stopped. Nothing was installed.`);
      }
      response = await (options.fetchImpl ?? fetch)(url.href, { redirect: "manual", signal: controller.signal });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location || hop >= MAX_REDIRECTS) {
        throw new StandaloneInstallError(`The ${name} download kept redirecting, so it was stopped. Nothing was installed.`);
      }
      url = new URL(location, url);
    }
    if (!response.ok || !response.body) {
      throw new StandaloneInstallError(`The ${name} download failed (HTTP ${response.status}). Check this computer's internet connection, then try again.`);
    }
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > cap) throw tooLarge();
    const hash = createHash("sha256");
    const handle = await open(destination, "wx", 0o600);
    let received = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.byteLength;
        if (received > cap) throw tooLarge();
        hash.update(chunk);
        await writeAll(handle, chunk);
      }
    } finally {
      await handle.close();
    }
    if (hash.digest("hex") !== asset.sha256) {
      throw new StandaloneInstallError(`The ${name} download failed its safety check, so nothing was installed. Try again later.`);
    }
  } catch (error) {
    if (error instanceof StandaloneInstallError) throw error;
    if (timedOut) throw new StandaloneInstallError(`The ${name} download took too long and was stopped. Check this computer's internet connection, then try again.`);
    if ((error as NodeJS.ErrnoException).code === "ENOSPC") throw error;
    const detail = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    throw new StandaloneInstallError(`${name} could not be downloaded (${detail}). Check this computer's internet connection, then try again.`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Plain files and folders only, each inside the staging folder; `./` prefixes are allowed. */
async function extractTarGz(archivePath: string, staging: string): Promise<void> {
  let unsafe = false;
  await tar.x({
    file: archivePath,
    cwd: staging,
    strict: true,
    preservePaths: false,
    umask: 0o022,
    filter: (path, entry) => {
      const type = "type" in entry ? entry.type : undefined;
      const name = path.replace(/^(?:\.\/)+/u, "").replace(/\/$/u, "");
      if (name === "" && type === "Directory") return false;
      if ((type !== "File" && type !== "Directory") || !safeArchivePath(name)) {
        unsafe = true;
        return false;
      }
      return true;
    },
  });
  if (unsafe) throw new StandaloneInstallError("The archive contains an unexpected or unsafe file. Nothing was installed.");
}

async function unpack(archivePath: string, staging: string, asset: StandaloneAsset): Promise<void> {
  if (asset.archive === "zip") await extractZip(archivePath, staging, { maxEntries: MAX_ZIP_MEMBERS });
  else if (asset.archive === "tar.gz") await extractTarGz(archivePath, staging);
  else {
    const target = executableIn(staging, asset.executable);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await rename(archivePath, target);
  }
}

const runCodesign: CodesignRunner = (args) => new Promise((resolveRun) => {
  execFile("/usr/bin/codesign", args, { timeout: 120_000, maxBuffer: 256 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
    const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : null) : 0;
    resolveRun({ code, output: `${stdout}${stderr}` });
  });
});

/** A valid signature from a certificate Apple issued to the pinned team: a self-made certificate naming the team fails. */
async function checkMacSigner(executable: string, release: StandaloneRelease, codesign: CodesignRunner): Promise<void> {
  const requirement = `=anchor apple generic and certificate leaf[subject.OU] = "${release.macTeamId}"`;
  const result = await codesign(["--verify", "--strict", "-R", requirement, executable]);
  if (result.code !== 0) throw new StandaloneInstallError(`The downloaded ${release.name} is not signed by its maker, so nothing was installed.`);
}

/** Null when `<executable> --version` exits cleanly and names the pinned version; otherwise what went wrong. */
function probeVersion(executable: string, release: StandaloneRelease): Promise<string | null> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...release.runEnv, PATH: augmentedPath() };
  stripWorkspaceCredentialEnv(env as Record<string, string | undefined>);
  return new Promise((resolveProbe) => {
    execFile(executable, ["--version"], { env, timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 64 * 1024, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
      const lines = (text: string) => stripVTControlCharacters(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      if (error) {
        const { code, killed } = error as { code?: unknown; killed?: boolean };
        const said = lines(stderr)[0]
          ?? (killed ? "it did not answer in time" : typeof code === "number" ? `it stopped with exit code ${code}` : lines(stdout)[0] ?? "it could not be run");
        return resolveProbe(said.slice(0, 400));
      }
      if (!stdout.includes(release.version)) return resolveProbe(`it reported version ${(lines(stdout)[0] ?? "nothing").slice(0, 80)}, not ${release.version}`);
      resolveProbe(null);
    });
  });
}

async function completedVersion(versionDir: string, release: StandaloneRelease, asset: StandaloneAsset): Promise<string | null> {
  const record = readRecord(versionDir);
  if (!record || record.engine !== release.engine || record.version !== release.version || record.sha256 !== asset.sha256 || record.executable !== asset.executable) return null;
  const executablePath = executableIn(versionDir, asset.executable);
  try {
    return (await lstat(executablePath)).isFile() ? executablePath : null;
  } catch {
    return null;
  }
}

async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

/** Keeps the current version and the newest other; anything older goes unless this server made it current. */
async function prune(engineDir: string, currentDir: string): Promise<void> {
  const entries = await readdir(engineDir, { withFileTypes: true });
  const versions: Array<{ dir: string; installedAt: number }> = [];
  for (const entry of entries) {
    const dir = join(engineDir, entry.name);
    if (entry.name.startsWith(DOWNLOAD_PREFIX) || entry.name.startsWith(STAGING_PREFIX)) {
      // What an interrupted install left; one still running elsewhere keeps its files recent.
      const info = await stat(dir).catch(() => null);
      if (info && Date.now() - info.mtimeMs > DOWNLOAD_TIMEOUT_MS * 2) await removeDir(dir).catch(() => {});
      continue;
    }
    if (!entry.isDirectory() || !VERSION_NAME.test(entry.name) || dir === currentDir) continue;
    const installedAt = readRecord(dir)?.installedAt;
    const modified = (await stat(dir).catch(() => null))?.mtimeMs ?? 0;
    versions.push({ dir, installedAt: typeof installedAt === "number" ? installedAt : modified });
  }
  versions.sort((a, b) => b.installedAt - a.installedAt);
  for (const old of versions.slice(1)) {
    if (activeVersions.has(old.dir)) continue;
    // A file something still holds open (Windows) stays until a later install.
    await rm(old.dir, { recursive: true, force: true }).catch(() => {});
  }
}

function activate(engineDir: string, release: StandaloneRelease, asset: StandaloneAsset, executablePath: string): StandaloneInstalled {
  const pointer: CurrentPointer = { version: release.version, executable: asset.executable, sha256: asset.sha256 };
  writeFileAtomic(join(engineDir, CURRENT), `${JSON.stringify(pointer)}\n`, { mode: 0o600 });
  activeVersions.add(join(engineDir, release.version));
  const binDir = dirname(executablePath);
  registerPathDir(binDir);
  resetPathCache();
  return { version: release.version, executablePath, binDir };
}

async function installOnce(release: StandaloneRelease, options: StandaloneInstallOptions): Promise<StandaloneInstalled> {
  const key = options.platformKey ?? standalonePlatformKey();
  const asset = standaloneAssetFor(release, key);
  if (!asset) throw new StandaloneInstallError(`${release.name} has no download for this computer.`);
  checkRelease(release, asset);
  const engineDir = standaloneEngineDir(release.engine, options.baseDir);
  const versionDir = join(engineDir, release.version);
  await mkdir(engineDir, { recursive: true, mode: 0o700 });

  const existing = await completedVersion(versionDir, release, asset);
  if (existing && (await probeVersion(existing, release)) === null) {
    const installed = activate(engineDir, release, asset, existing);
    await prune(engineDir, versionDir).catch(() => {});
    return installed;
  }

  const tag = randomUUID();
  const archivePath = join(engineDir, `${DOWNLOAD_PREFIX}${tag}.part`);
  const staging = join(engineDir, `${STAGING_PREFIX}${tag}`);
  let placed = false;
  try {
    await download(release, asset, archivePath, options);
    await mkdir(staging, { mode: 0o700 });
    await unpack(archivePath, staging, asset);
    const stagedExecutable = executableIn(staging, asset.executable);
    if (!(await lstat(stagedExecutable).catch(() => null))?.isFile()) {
      throw new StandaloneInstallError(`The ${release.name} download did not contain the program it should, so nothing was installed.`);
    }
    if (process.platform !== "win32") await chmod(stagedExecutable, 0o755);
    if (key.startsWith("darwin-") && release.macTeamId) await checkMacSigner(stagedExecutable, release, options.codesign ?? runCodesign);
    const record: InstallRecord = { engine: release.engine, version: release.version, sha256: asset.sha256, executable: asset.executable, installedAt: Date.now() };
    await writeFile(join(staging, RECORD), `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });

    // Whatever holds this version's name now (a partial or different build, or a copy that no longer starts) makes way.
    if (existsSync(versionDir)) await removeDir(versionDir);
    try {
      renameWithRetry(staging, versionDir);
      placed = true;
    } catch (error) {
      // Another OpenMausBot process finished the same build first.
      if (!(await completedVersion(versionDir, release, asset))) throw error;
    }
    const executablePath = executableIn(versionDir, asset.executable);
    const failure = await probeVersion(executablePath, release);
    if (failure !== null) {
      if (placed) await removeDir(versionDir).catch(() => {});
      throw new StandaloneInstallError(`${release.name} was downloaded, but it does not start on this computer (${failure}). Nothing was installed.`);
    }
    const installed = activate(engineDir, release, asset, executablePath);
    await prune(engineDir, versionDir).catch(() => {});
    return installed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
      const megabytes = Math.ceil((asset.approxBytes * 4) / 1024 / 1024);
      throw new StandaloneInstallError(`There is not enough free disk space to install ${release.name}. Free up about ${megabytes} MB, then try again.`);
    }
    throw error;
  } finally {
    // Cleanup must never replace the real error.
    await rm(archivePath, { force: true }).catch(() => {});
    await removeDir(staging).catch(() => {});
  }
}

/** Install or reuse the pinned build for this computer. Installs of one engine that overlap share a single run. */
export function installStandaloneEngine(release: StandaloneRelease, options: StandaloneInstallOptions = {}): Promise<StandaloneInstalled> {
  const key = standaloneEngineDir(release.engine, options.baseDir);
  const existing = running.get(key);
  if (existing) return existing;
  const run = installOnce(release, options).finally(() => running.delete(key));
  running.set(key, run);
  return run;
}

export function resetStandaloneStateForTests(): void {
  activeVersions.clear();
  muslHost = undefined;
}
