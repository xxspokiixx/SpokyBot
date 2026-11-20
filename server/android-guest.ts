// Android cannot exec a glibc binary.
//
// The engines a person installs are built for Debian, and their ELF interpreter is
// /lib/ld-linux-aarch64.so.1 — a glibc path Android does not have. `execve` answers "No such file
// or directory" for a file that is present and executable, which the engine probe then reports as
// "isn't executable", and the key a person just saved is never used.
//
// The phone already ships proot and a rootfs with that loader, and every guest command runs through
// them. This wraps an engine the same way, so a glibc CLI starts on a phone exactly as it does in
// the guest.
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The guest paths a wrapped engine needs to find its own files and its config. */
export interface AndroidGuestConfig {
  linuxDir: string;
  rootfs: string;
  dataDir?: string;
  tmpDir: string;
}

export interface WrappedCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** The guest config from the environment the phone's shell sets, or null off the phone.
 *
 *  The shell gives the server the linux dir, the rootfs and the data dir; the tmp dir it only gives
 *  the MCP child, so it is derived here rather than required. Requiring it made this answer null on
 *  the server, and the wrapper never applied. */
export function androidGuest(env?: NodeJS.ProcessEnv): AndroidGuestConfig | null {
  const source = env ?? process.env;
  if (source.OMB_ANDROID_STANDALONE !== "1") return null;
  const linuxDir = source.OMB_ANDROID_LINUX_DIR;
  const rootfs = source.OMB_ANDROID_ROOTFS;
  if (!linuxDir || !rootfs) return null;
  const tmpDir = source.OMB_ANDROID_TMP_DIR || join(linuxDir, "tmp");
  return { linuxDir, rootfs, tmpDir, ...(source.OMB_ANDROID_DATA_DIR ? { dataDir: source.OMB_ANDROID_DATA_DIR } : {}) };
}

/** Whether this process is a guest engine the phone has to run through proot. */
export function needsGuestLoader(cli: string, env?: NodeJS.ProcessEnv): boolean {
  const guest = androidGuest(env);
  if (!guest) return false;
  // Only a binary staged beside proot is a glibc build; a guest `sh` or a Node script is not.
  return existsSync(join(guest.linuxDir, cli));
}

/** Runs `cli` inside the guest: the phone's proot, its rootfs, and the loader it maps binaries with. */
export function guestCommandFor(guest: AndroidGuestConfig, cli: string, args: string[], env: NodeJS.ProcessEnv = process.env): WrappedCommand {
  const binary = cli.startsWith("/") ? cli : join(guest.linuxDir, cli);
  // The binary lives outside the rootfs, so it rides the /host-linux bind and is named from there.
  const inside = `/host-linux/${binary.slice(guest.linuxDir.length + 1)}`;
  const binds = ["-b", `${guest.linuxDir}:/host-linux`, "-b", `${guest.tmpDir}:/tmp`];
  if (guest.dataDir) binds.push("-b", `${guest.dataDir}:/data`);
  for (const file of ["passwd", "group"]) {
    const host = join(guest.rootfs, "etc", file);
    if (existsSync(host)) binds.push("-b", `${host}:/etc/${file}`);
  }
  return {
    command: join(guest.linuxDir, "proot"),
    args: [
      "-R", guest.rootfs, "-0", "-w", "/root", ...binds,
      inside, ...args,
    ],
    env: {
      ...env,
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/host-linux",
      HOME: "/root",
      TMPDIR: "/tmp",
      LD_LIBRARY_PATH: guest.linuxDir,
      PROOT_TMP_DIR: guest.tmpDir,
      PROOT_NO_SECCOMP: "1",
      PROOT_ASSUME_MEMFD_UNSUPPORTED: "1",
      PROOT_LOADER: join(guest.linuxDir, "loader"),
    },
  };
}
