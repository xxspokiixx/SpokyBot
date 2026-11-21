// Installs the guest's Chromium the first time the phone needs a browser.
//
// The rootfs the app extracts ships no browser: apt has the package for arm64, but it is about
// 300 MB, so it is fetched once on the device instead of carried in every APK. The install runs
// in the background — a bot's first turn must not wait on an apt that takes minutes — and a marker
// file records success so a later boot does not repeat it.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { AndroidGuestConfig } from "./android-guest.ts";

/** Debian's chromium on arm64: what the wrapper `omb-guest-chromium` execs. */
export const CHROMIUM_BINARY = "usr/lib/chromium/chromium";
const MARKER = ".chromium-installed";
/** Playwright-quality rendering needs these beside the binary; the package pulls most of them itself. */
const PACKAGES = "chromium fonts-liberation";

/** Unpacks the downloaded packages straight into the rootfs.
 *
 *  `dpkg -i` cannot run here: it writes its backup by renaming over `var/lib/dpkg/status-old`, and
 *  Android's storage refuses that rename. `dpkg-deb -x` writes plain files, which it allows, and the
 *  files are what the browser needs — no package is being upgraded, so the database adds nothing. */
const UNPACK = `export DEBIAN_FRONTEND=noninteractive TMPDIR=/tmp; ` +
  `apt-get update -qq && apt-get install -y --no-install-recommends --download-only ${PACKAGES} && ` +
  `cd /var/cache/apt/archives && ` +
  `(for archive in chromium_*.deb chromium-common_*.deb fonts-liberation_*.deb; do dpkg-deb -x "$archive" /; done)`;

let installing: Promise<boolean> | null = null;

/** Whether this guest can start a browser right now. */
export function guestChromiumReady(guest: AndroidGuestConfig): boolean {
  return existsSync(join(guest.rootfs, CHROMIUM_BINARY));
}

/** Installs Chromium once, in the background. Resolves true when it is present afterwards.
 *
 *  Never throws: a phone with no network or no room in the rootfs keeps working, and the next
 *  start tries again. */
export function ensureGuestChromium(guest: AndroidGuestConfig, log: (line: string) => void = () => {}): Promise<boolean> {
  if (guestChromiumReady(guest)) return Promise.resolve(true);
  if (installing) return installing;
  if (process.env.OMB_ANDROID_SKIP_CHROMIUM === "1") return Promise.resolve(false);

  installing = new Promise<boolean>((resolve) => {
    const child = spawn(join(guest.linuxDir, "proot"), [
      "-0", "-R", guest.rootfs,
      "-b", `${guest.rootfs}/etc/passwd:/etc/passwd`,
      "-b", `${guest.rootfs}/etc/group:/etc/group`,
      "-b", `${guest.rootfs}/etc/shadow:/etc/shadow`,
      "-b", `${guest.linuxDir}:/host-linux`,
      // The archive's own /tmp belongs to a uid the guest never holds, so apt cannot write the
      // temporary config it passes to apt-key and every repository reads as unsigned. Bind the
      // phone's tmp over it, which is what every other guest command already does.
      "-b", `${guest.tmpDir}:/tmp`,
      "-w", "/root", "/bin/bash", "-lc", UNPACK,
    ], {
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: "/root",
        TMPDIR: guest.tmpDir,
        LD_LIBRARY_PATH: guest.linuxDir,
        PROOT_TMP_DIR: guest.tmpDir,
        PROOT_NO_SECCOMP: "1",
        PROOT_ASSUME_MEMFD_UNSUPPORTED: "1",
        PROOT_LOADER: join(guest.linuxDir, "loader"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const keep = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4_000); };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);

    const finish = (ok: boolean) => {
      installing = null;
      if (ok) {
        try { writeFileSync(join(guest.rootfs, MARKER), new Date().toISOString()); } catch { /* the binary is what counts */ }
        log("browser: Chromium installed in the phone's Linux environment");
      } else {
        log(`browser: Chromium is still not installed (${output.trim().split("\n").at(-1)?.slice(0, 200) ?? "no output"})`);
      }
      resolve(ok);
    };

    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0 && guestChromiumReady(guest)));

    // Half an hour: a slow phone on a slow connection still finishes, and a hung apt stops holding the flag.
    setTimeout(() => {
      if (installing === null) return;
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish(false);
    }, 30 * 60_000).unref?.();
  });
  return installing;
}
