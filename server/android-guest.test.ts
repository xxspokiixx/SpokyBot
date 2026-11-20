// The wrapper's own contract: a glibc engine on the phone becomes a proot run, and nothing else does.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { androidGuest, guestCommandFor, guestWorkspacePath, needsGuestLoader } from "./android-guest.ts";

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

describe("the folder a guest engine is told to work in", () => {
  it("names it by the mount the guest sees, not by the phone's own path", () => {
    // OpenCode was handed /data/user/0/<pkg>/files/data/task-workspaces/x, answered NotFound, and
    // every turn failed before its first model call.
    const { env, dir } = phone();
    try {
      expect(guestWorkspacePath(join(dir, "data", "task-workspaces", "b", "t"), env)).toBe("/data/task-workspaces/b/t");
      expect(guestWorkspacePath(join(dir, "data"), env)).toBe("/data");
      expect(guestWorkspacePath(env.OMB_ANDROID_LINUX_DIR!, env)).toBe("/host-linux");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("leaves a desktop path alone, where there is no guest at all", () => {
    const plain = { PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    expect(guestWorkspacePath("/home/someone/project", plain)).toBe("/home/someone/project");
  });

  it("leaves a path outside the mounts alone rather than inventing one", () => {
    // Guessing would point the engine at a folder that is not the one the person meant.
    const { env, dir } = phone();
    try {
      expect(guestWorkspacePath("/sdcard/Download", env)).toBe("/sdcard/Download");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
