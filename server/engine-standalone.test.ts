// A local HTTP server stands in for the vendor's download host: the test fetch maps https://<host>/<path> onto it, so the
// installer's own HTTPS, host and redirect checks run unchanged. Nothing here reaches the internet.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { StandaloneAsset, StandaloneRelease } from "./contracts.ts";
import {
  installStandaloneEngine,
  registerStandaloneBinDirs,
  resetStandaloneStateForTests,
  standaloneAssetFor,
  standaloneEngineDir,
  standalonePlatformKey,
  standaloneRunEnv,
  type CodesignRunner,
} from "./engine-standalone.ts";
import { augmentedPath, findCliCandidates, resetPathCacheForTests } from "./env-path.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { buildZip } from "./testing/zip-fixture.ts";

const VERSION = "1.2.3";
const ENGINE = "fake-engine";
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

describe("which build this machine gets", () => {
  it("names the platform and architecture, with musl only on Linux without glibc", () => {
    expect(standalonePlatformKey("darwin", "arm64", false)).toBe("darwin-arm64");
    expect(standalonePlatformKey("darwin", "x64", true)).toBe("darwin-x64");
    expect(standalonePlatformKey("linux", "x64", false)).toBe("linux-x64");
    expect(standalonePlatformKey("linux", "arm64", true)).toBe("linux-arm64-musl");
    expect(standalonePlatformKey("win32", "arm64", false)).toBe("win32-arm64");
  });

  it("offers only a build made for this exact platform, never a glibc build to a musl machine", () => {
    const asset: StandaloneAsset = { url: "https://downloads.example.test/a", sha256: "0".repeat(64), archive: "raw", executable: "x", approxBytes: 1 };
    const release = fixtureRelease({ "linux-x64": asset });
    expect(standaloneAssetFor(release, "linux-x64")).toBe(asset);
    expect(standaloneAssetFor(release, "linux-x64-musl")).toBeNull();
    expect(standaloneAssetFor(release, "freebsd-x64")).toBeNull();
  });
});

function fixtureRelease(assets: StandaloneRelease["assets"], extra: Partial<StandaloneRelease> = {}): StandaloneRelease {
  return {
    name: "Fake Engine",
    engine: ENGINE,
    version: VERSION,
    hosts: ["downloads.example.test", "assets.example.test"],
    runEnv: { FAKE_RUN_ENV: "app-copy" },
    assets,
    ...extra,
  };
}

interface Route { status?: number; headers?: Record<string, string>; body?: Buffer; chunked?: boolean }

function useAssetServer() {
  const routes = new Map<string, Route>();
  const hits = new Map<string, number>();
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const key = req.url!.slice(1);
      hits.set(key, (hits.get(key) ?? 0) + 1);
      const route = routes.get(key);
      if (!route) {
        res.writeHead(404).end();
        return;
      }
      const body = route.body ?? Buffer.alloc(0);
      res.writeHead(route.status ?? 200, { ...(route.chunked ? {} : { "content-length": String(body.length) }), ...route.headers });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    routes.clear();
    hits.clear();
  });
  const fetchImpl = ((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    return fetch(`http://127.0.0.1:${port}/${url.host}${url.pathname}`, init);
  }) as typeof fetch;
  return { routes, hits: (key: string) => hits.get(key) ?? 0, fetchImpl };
}

describe.skipIf(process.platform === "win32")("installing a standalone engine", () => {
  const server = useAssetServer();
  let scratch = "";
  let base = "";
  let log = "";
  let originalPath: string | undefined;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "omb-standalone-"));
    base = join(scratch, "data");
    log = join(scratch, "runs.log");
    originalPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    resetPathCacheForTests();
    resetStandaloneStateForTests();
  });
  afterEach(async () => {
    process.env.PATH = originalPath;
    resetPathCacheForTests();
    resetStandaloneStateForTests();
    await removeTempDir(scratch);
  });

  const engineDir = () => standaloneEngineDir(ENGINE, base);
  const leftovers = () => existsSync(engineDir()) ? readdirSync(engineDir()).sort() : [];
  const script = (printed = `fake-engine ${VERSION}`, exit = 0) =>
    `#!/bin/sh\necho "$* $FAKE_RUN_ENV" >> '${log}'\necho '${printed}'\nexit ${exit}\n`;

  async function tarGz(files: Record<string, string>): Promise<Buffer> {
    const source = mkdtempSync(join(scratch, "tar-src-"));
    for (const [name, data] of Object.entries(files)) {
      mkdirSync(dirname(join(source, name)), { recursive: true });
      writeFileSync(join(source, name), data);
      chmodSync(join(source, name), 0o755);
    }
    const file = join(scratch, `fixture-${Math.random().toString(36).slice(2)}.tar.gz`);
    await tar.c({ gzip: true, file, cwd: source, portable: true }, Object.keys(files));
    return readFileSync(file);
  }

  /** Serves `body` the way GitHub does: the release URL redirects to an asset host. */
  function serve(body: Buffer, archive: StandaloneAsset["archive"], executable: string, overrides: Partial<StandaloneAsset> = {}): StandaloneAsset {
    server.routes.set("downloads.example.test/releases/fake", { status: 302, headers: { location: "https://assets.example.test/blob/fake" } });
    server.routes.set("assets.example.test/blob/fake", { body });
    return { url: "https://downloads.example.test/releases/fake", sha256: sha256(body), archive, executable, approxBytes: body.length, ...overrides };
  }

  async function build(kind: StandaloneAsset["archive"], body = script()): Promise<{ data: Buffer; executable: string }> {
    if (kind === "zip") return { data: buildZip([{ name: "fake-engine", data: body, mode: 0o100755 }]), executable: "fake-engine" };
    if (kind === "tar.gz") return { data: await tarGz({ "bin/fake-engine": body }), executable: "bin/fake-engine" };
    return { data: Buffer.from(body), executable: "fake-engine" };
  }

  const install = (release: StandaloneRelease, extra: Parameters<typeof installStandaloneEngine>[1] = {}) =>
    installStandaloneEngine(release, { baseDir: base, fetchImpl: server.fetchImpl, ...extra });

  it.each(["zip", "tar.gz", "raw"] as const)("installs a verified %s build, points current.json at it and puts it first on PATH", async (kind) => {
    const { data, executable } = await build(kind);
    const asset = serve(data, kind, executable);
    const installed = await install(fixtureRelease({ [standalonePlatformKey()]: asset }));

    const expectedPath = join(engineDir(), VERSION, ...executable.split("/"));
    expect(installed).toEqual({ version: VERSION, executablePath: expectedPath, binDir: dirname(expectedPath) });
    expect(JSON.parse(readFileSync(join(engineDir(), "current.json"), "utf8"))).toMatchObject({ version: VERSION, executable, sha256: asset.sha256 });
    expect(augmentedPath().split(delimiter)[0]).toBe(dirname(expectedPath));
    expect(findCliCandidates("fake-engine")[0]).toBe(expectedPath);
    // The probe ran the installed copy with its run settings.
    expect(readFileSync(log, "utf8")).toBe("--version app-copy\n");
    expect(leftovers()).toEqual([VERSION, "current.json"]);
  });

  it("refuses a download that fails its SHA-256 check and leaves nothing behind", async () => {
    const { data, executable } = await build("zip");
    const asset = serve(data, "zip", executable, { sha256: "0".repeat(64) });
    await expect(install(fixtureRelease({ [standalonePlatformKey()]: asset }))).rejects.toThrow(/safety check/);
    expect(leftovers()).toEqual([]);
    expect(existsSync(log)).toBe(false);
  });

  it.each([["without", true], ["with", false]] as const)("stops a download over twice its expected size, %s a Content-Length", async (_label, chunked) => {
    const body = Buffer.alloc(4096, 1);
    const asset = serve(body, "raw", "fake-engine", { approxBytes: 1000 });
    server.routes.set("assets.example.test/blob/fake", { body, chunked });
    await expect(install(fixtureRelease({ [standalonePlatformKey()]: asset }))).rejects.toThrow(/larger than expected/);
    expect(leftovers()).toEqual([]);
  });

  it("refuses a redirect to a host it does not trust, without contacting that host", async () => {
    const { data, executable } = await build("raw");
    const asset = serve(data, "raw", executable);
    server.routes.set("downloads.example.test/releases/fake", { status: 302, headers: { location: "https://mirror.evil.test/blob/fake" } });
    server.routes.set("mirror.evil.test/blob/fake", { body: data });
    await expect(install(fixtureRelease({ [standalonePlatformKey()]: asset }))).rejects.toThrow(/official site/);
    expect(server.hits("mirror.evil.test/blob/fake")).toBe(0);
    expect(leftovers()).toEqual([]);
  });

  it("refuses plain HTTP, for the first request and for a redirect", async () => {
    const { data, executable } = await build("raw");
    const asset = serve(data, "raw", executable);
    await expect(install(fixtureRelease({ [standalonePlatformKey()]: { ...asset, url: "http://downloads.example.test/releases/fake" } }))).rejects.toThrow(/official site/);
    expect(server.hits("downloads.example.test/releases/fake")).toBe(0);
    server.routes.set("downloads.example.test/releases/fake", { status: 302, headers: { location: "http://assets.example.test/blob/fake" } });
    await expect(install(fixtureRelease({ [standalonePlatformKey()]: asset }))).rejects.toThrow(/official site/);
    expect(server.hits("assets.example.test/blob/fake")).toBe(0);
  });

  it("shares one download between installs that start together, and reuses the verified copy later", async () => {
    const { data, executable } = await build("tar.gz");
    const release = fixtureRelease({ [standalonePlatformKey()]: serve(data, "tar.gz", executable) });
    const [first, second] = await Promise.all([install(release), install(release)]);
    expect(second).toEqual(first);
    expect(server.hits("assets.example.test/blob/fake")).toBe(1);
    await install(release);
    expect(server.hits("assets.example.test/blob/fake")).toBe(1);
  });

  it("downloads again when the installed copy of this version no longer starts", async () => {
    const { data, executable } = await build("raw");
    const release = fixtureRelease({ [standalonePlatformKey()]: serve(data, "raw", executable) });
    const installed = await install(release);
    // A scanner or a person broke the program but left its install record.
    writeFileSync(installed.executablePath, "#!/bin/sh\nexit 1\n");
    await expect(install(release)).resolves.toEqual(installed);
    expect(server.hits("assets.example.test/blob/fake")).toBe(2);
    expect(readFileSync(installed.executablePath)).toEqual(data);
  });

  it("refuses a tar.gz holding a link, and keeps none of it", async () => {
    const source = mkdtempSync(join(scratch, "tar-link-"));
    writeFileSync(join(source, "fake-engine"), script(), { mode: 0o755 });
    symlinkSync("/etc/hosts", join(source, "hosts"));
    const file = join(scratch, "link.tar.gz");
    await tar.c({ gzip: true, file, cwd: source, portable: true }, ["fake-engine", "hosts"]);
    await expect(install(fixtureRelease({ [standalonePlatformKey()]: serve(readFileSync(file), "tar.gz", "fake-engine") }))).rejects.toThrow(/unsafe/);
    expect(leftovers()).toEqual([]);
  });

  it("refuses a macOS build signed by someone other than its maker", async () => {
    // Like codesign: the requirement passes only for a certificate Apple issued to the team that signed the file.
    const signedBy = (team: string): CodesignRunner => async (args) => {
      const requirement = args[args.indexOf("-R") + 1] ?? "";
      const ok = requirement.startsWith("=anchor apple generic and ") && requirement.includes(`certificate leaf[subject.OU] = "${team}"`);
      return { code: ok ? 0 : 3, output: ok ? "" : "test-requirement: code failed to satisfy specified code requirement(s)" };
    };
    const { data, executable } = await build("zip");
    const release = fixtureRelease({ "darwin-arm64": serve(data, "zip", executable) }, { macTeamId: "PINNED0001" });
    await expect(install(release, { platformKey: "darwin-arm64", codesign: signedBy("OTHER00001") })).rejects.toThrow(/not signed by its maker/);
    expect(leftovers()).toEqual([]);
    await expect(install(release, { platformKey: "darwin-arm64", codesign: signedBy("PINNED0001") })).resolves.toMatchObject({ version: VERSION });
  });

  it.each([["exits with an error", script(`fake-engine ${VERSION}`, 1)], ["reports another version", script("fake-engine 9.9.9")]])("refuses a build that %s, and keeps none of it", async (_label, body) => {
    const { data, executable } = await build("raw", body);
    await expect(install(fixtureRelease({ [standalonePlatformKey()]: serve(data, "raw", executable) }))).rejects.toThrow(/does not start/);
    expect(leftovers()).toEqual([]);
  });

  it("refuses a release whose version or executable could leave its folder", async () => {
    const { data } = await build("raw");
    const asset = serve(data, "raw", "fake-engine");
    await expect(install({ ...fixtureRelease({ [standalonePlatformKey()]: asset }), version: "../1.2.3" })).rejects.toThrow(/invalid/);
    await expect(install(fixtureRelease({ [standalonePlatformKey()]: { ...asset, executable: "../fake-engine" } }))).rejects.toThrow(/invalid/);
    expect(server.hits("downloads.example.test/releases/fake")).toBe(0);
  });

  describe("old versions", () => {
    function seedVersion(version: string, installedAt: number): void {
      const directory = join(engineDir(), version);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "fake-engine"), script(`fake-engine ${version}`), { mode: 0o755 });
      writeFileSync(join(directory, ".standalone-install.json"), JSON.stringify({ engine: ENGINE, version, sha256: "a".repeat(64), executable: "fake-engine", installedAt }));
    }
    function pointCurrentAt(version: string): void {
      writeFileSync(join(engineDir(), "current.json"), JSON.stringify({ version, executable: "fake-engine", sha256: "a".repeat(64) }));
    }

    it("keeps the new version and the one before it, and deletes older ones", async () => {
      seedVersion("1.0.0", 1);
      seedVersion("1.1.0", 2);
      pointCurrentAt("1.1.0");
      const { data, executable } = await build("raw");
      await install(fixtureRelease({ [standalonePlatformKey()]: serve(data, "raw", executable) }));
      expect(leftovers()).toEqual(["1.1.0", VERSION, "current.json"]);
    });

    it("never deletes a version this server started with, since its processes may still be running", async () => {
      seedVersion("1.0.0", 1);
      seedVersion("1.1.0", 2);
      pointCurrentAt("1.0.0");
      registerStandaloneBinDirs(base);
      const { data, executable } = await build("raw");
      const release = fixtureRelease({ [standalonePlatformKey()]: serve(data, "raw", executable) });
      await install(release);
      expect(leftovers()).toEqual(["1.0.0", "1.1.0", VERSION, "current.json"]);
      // After a restart nothing runs 1.0.0 any more.
      resetStandaloneStateForTests();
      await install(release);
      expect(leftovers()).toEqual(["1.1.0", VERSION, "current.json"]);
    });
  });

  describe("at start-up", () => {
    it("puts each engine's current version first on PATH", async () => {
      const { data, executable } = await build("tar.gz");
      const installed = await install(fixtureRelease({ [standalonePlatformKey()]: serve(data, "tar.gz", executable) }));
      resetPathCacheForTests();
      resetStandaloneStateForTests();
      registerStandaloneBinDirs(base);
      expect(augmentedPath().split(delimiter)[0]).toBe(installed.binDir);
    });

    it("ignores a current.json that points outside its folder or at nothing", () => {
      // A complete-looking install outside the engine's folder.
      const outside = join(base, "elsewhere");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "fake-engine"), script(), { mode: 0o755 });
      writeFileSync(join(outside, ".standalone-install.json"), JSON.stringify({ engine: ENGINE, version: VERSION, sha256: "a".repeat(64), executable: "fake-engine", installedAt: 1 }));
      mkdirSync(join(engineDir(), "1.0.0"), { recursive: true });
      writeFileSync(join(engineDir(), "current.json"), JSON.stringify({ version: "../../../elsewhere", executable: "fake-engine", sha256: "a".repeat(64) }));
      registerStandaloneBinDirs(base);
      writeFileSync(join(engineDir(), "current.json"), JSON.stringify({ version: "1.0.0", executable: "missing", sha256: "a".repeat(64) }));
      registerStandaloneBinDirs(base);
      writeFileSync(join(engineDir(), "current.json"), "{ not json");
      registerStandaloneBinDirs(base);
      expect(augmentedPath().split(delimiter)[0]).toBe("/usr/bin");
    });
  });

  it("gives run settings to the app's own copy only, never to a copy installed elsewhere", async () => {
    const { data, executable } = await build("raw");
    const release = fixtureRelease({ [standalonePlatformKey()]: serve(data, "raw", executable) });
    expect(standaloneRunEnv(release, "fake-engine", base)).toEqual({});
    const installed = await install(release);
    expect(standaloneRunEnv(release, "fake-engine", base)).toEqual({ FAKE_RUN_ENV: "app-copy" });
    expect(standaloneRunEnv(release, installed.executablePath, base)).toEqual({ FAKE_RUN_ENV: "app-copy" });
    const own = join(scratch, "own-bin");
    mkdirSync(own);
    writeFileSync(join(own, "fake-engine"), script(), { mode: 0o755 });
    expect(standaloneRunEnv(release, join(own, "fake-engine"), base)).toEqual({});
  });
});
