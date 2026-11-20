// The wrapper's own contract: a glibc engine on the phone becomes a proot run, and nothing else does.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { androidGuest, guestCommandFor, needsGuestLoader } from "./android-guest.ts";

function phone() {
  const dir = mkdtempSync(join(tmpdir(), "omb-guest-"));
  const linux = join(dir, "linux");
  const rootfs = join(linux, "rootfs");
  mkdirSync(join(rootfs, "etc"), { recursive: true });
  mkdirSync(join(linux, "tmp"), { recursive: true });
  writeFileSync(join(linux, "opencode"), "binary");
  writeFileSync(join(linux, "loader"), "loader");
  writeFileSync(join(rootfs, "etc", "passwd"), "root:x:0:0::/root:/bin/bash\n");
  writeFileSync(join(rootfs, "etc", "group"), "root:x:0:\n");
  return {
    dir,
    linux,
    rootfs,
    env: {
      OMB_ANDROID_STANDALONE: "1",
      OMB_ANDROID_LINUX_DIR: linux,
      OMB_ANDROID_ROOTFS: rootfs,
      OMB_ANDROID_TMP_DIR: join(linux, "tmp"),
      OMB_ANDROID_DATA_DIR: join(dir, "data"),
    } as NodeJS.ProcessEnv,
  };
}

describe("a glibc engine on the phone", () => {
  it("is recognised as needing the guest loader", () => {
    const { env, dir } = phone();
    try {
      expect(needsGuestLoader("opencode", env)).toBe(true);
      expect(needsGuestLoader("not-here", env)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("runs through proot from the /host-linux bind, with argv kept separate", () => {
    const { env, linux, rootfs, dir } = phone();
    try {
      const guest = androidGuest(env)!;
      const wrapped = guestCommandFor(guest, "opencode", ["--version"]);
      expect(wrapped.command).toBe(join(linux, "proot"));
      // The binary is outside the rootfs, so it is named from the bind that carries it.
      expect(wrapped.args).toContain("/host-linux/opencode");
      expect(wrapped.args.at(-2)).toBe("/host-linux/opencode");
      expect(wrapped.args.at(-1)).toBe("--version");
      expect(wrapped.args).toContain(rootfs);
      // A quoted prompt must reach the CLI as one argument, never through a shell.
      expect(wrapped.args).not.toContain("-c");
      expect(wrapped.env.PROOT_LOADER).toBe(join(linux, "loader"));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("is not wrapped anywhere but the phone", () => {
    expect(androidGuest({} as NodeJS.ProcessEnv)).toBeNull();
    expect(needsGuestLoader("opencode", {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("wraps an installed standalone engine, which lives outside the linux dir", () => {
    const { env, dir } = phone();
    try {
      // An engine the app downloaded sits under tools/standalone/, not beside proot.
      const installed = join(dir, "data", "tools", "standalone", "dsh", "bin", "dsh");
      mkdirSync(dirname(installed), { recursive: true });
      writeFileSync(installed, "binary");
      expect(needsGuestLoader(installed, env), "an absolute installed engine is wrapped").toBe(true);
      const wrapped = guestCommandFor(androidGuest(env)!, installed, ["--version"]);
      // It rides its own mount, so the guest can name a file outside the linux dir.
      expect(wrapped.args).toContain("/host-tool");
      expect(wrapped.args.at(-1)).toBe("--version");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("works when the shell omits the tmp dir, which is what the server actually gets", () => {
    // The server's own environment carries the linux dir, the rootfs and the data dir, and no
    // OMB_ANDROID_TMP_DIR: requiring one made every engine look like a desktop engine.
    const { dir, linux, rootfs } = phone();
    try {
      const env = {
        OMB_ANDROID_STANDALONE: "1",
        OMB_ANDROID_LINUX_DIR: linux,
        OMB_ANDROID_ROOTFS: rootfs,
        OMB_ANDROID_DATA_DIR: join(dir, "data"),
      } as NodeJS.ProcessEnv;
      const guest = androidGuest(env);
      expect(guest, "the phone is still recognised").not.toBeNull();
      expect(guest!.tmpDir).toBe(join(linux, "tmp"));
      expect(needsGuestLoader("opencode", env)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
