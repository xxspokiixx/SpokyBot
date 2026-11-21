// The phone's Chromium is fetched once, and its absence never stops the server.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CHROMIUM_BINARY, ensureGuestChromium, guestChromiumReady } from "./android-chromium.ts";

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

  it("answers false instead of throwing when there is no proot to install through", async () => {
    const config = guest(false);
    const log: string[] = [];
    // Nothing can be installed here, and the turn that asked must still get an answer.
    await expect(ensureGuestChromium(config, (line) => log.push(line))).resolves.toBe(false);
    expect(guestChromiumReady(config)).toBe(false);
  });
});
