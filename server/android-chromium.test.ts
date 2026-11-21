// The phone's Chromium is fetched once, and its absence never stops the server.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CHROMIUM_BINARY, ensureGuestChromium, guestChromiumReady, guestSocketDir } from "./android-chromium.ts";

const roots: string[] = [];
function guest(withChromium: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "omb-chromium-"));
  roots.push(dir);
  const linuxDir = join(dir, "linux");
  const rootfs = join(linuxDir, "rootfs");
  mkdirSync(join(rootfs, "etc"), { recursive: true });
  mkdirSync(join(linuxDir, "tmp"), { recursive: true });
  if (withChromium) {
    mkdirSync(join(rootfs, "usr", "lib", "chromium"), { recursive: true });
    writeFileSync(join(rootfs, CHROMIUM_BINARY), "binary");
    // The two libraries the archive never carries: without them Chrome exits at load.
    mkdirSync(join(rootfs, "usr", "lib", "aarch64-linux-gnu"), { recursive: true });
    for (const library of ["libnss3.so", "libgbm.so.1"]) writeFileSync(join(rootfs, "usr", "lib", "aarch64-linux-gnu", library), "lib");
  }
  return { linuxDir, rootfs, tmpDir: join(linuxDir, "tmp") };
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("the phone's Chromium", () => {
  it("is already there when the rootfs carries it, so nothing is downloaded", () => {
    const config = guest(true);
    expect(guestChromiumReady(config)).toBe(true);
  });

  it("is missing from a rootfs built without it", () => {
    // The archive the app extracts has no browser, which is why the launcher failed every start.
    expect(guestChromiumReady(guest(false))).toBe(false);
  });

  it("is not ready with the binary alone, because its libraries arrive with the package", () => {
    // Chrome exits at load when libnss3 or libgbm is absent, which reads as a closed DevTools pipe.
    const config = guest(true);
    rmSync(join(config.rootfs, "usr", "lib", "aarch64-linux-gnu", "libnss3.so"));
    expect(guestChromiumReady(config)).toBe(false);
  });

  it("answers false instead of throwing when there is no proot to install through", async () => {
    const config = guest(false);
    const log: string[] = [];
    // Nothing can be installed here, and the turn that asked must still get an answer.
    await expect(ensureGuestChromium(config, (line) => log.push(line))).resolves.toBe(false);
    expect(guestChromiumReady(config)).toBe(false);
  });
});

describe("where the phone's browser engine keeps its sockets", () => {
  it("names a folder short enough for a bot's session under the 103-byte limit", () => {
    const config = guest(true);
    const dataDir = join(config.linuxDir, "..", "data");
    const dir = guestSocketDir({ ...config, dataDir });
    // Same folder the app owns: beside data, not inside it, so the session id has room.
    expect(dir.endsWith("/ab")).toBe(true);
    expect(dir).not.toContain("/data/");
    const socket = `${dir}/bot-07cefc48-182b-41ff-a28e-f6130178f7b5.socket`;
    // The phone's own data dir is long enough to push this over on its own, which failed every browser call.
    expect(`${dataDir.replaceAll("\\\\", "/")}/bot-07cefc48-182b-41ff-a28e-f6130178f7b5.socket`.length)
      .toBeGreaterThan(socket.length);
  });

  it("falls back inside the linux dir when there is no data dir to sit beside", () => {
    const config = guest(true);
    // The phone's paths are POSIX whatever machine runs this code.
    expect(guestSocketDir(config)).toBe(`${config.linuxDir.replaceAll("\\", "/")}/tmp/ab`);
  });});
