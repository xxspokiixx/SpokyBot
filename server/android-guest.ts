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
import { existsSync, mkdirSync } from "node:fs";
import { basename, join, sep } from "node:path";

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

/** Whether this process is a guest engine the phone has to run through proot: a binary staged beside
 *  proot, or a bare name that resolves to one. An absolute path is checked where it points. */
export function needsGuestLoader(cli: string, env?: NodeJS.ProcessEnv): boolean {
  const guest = androidGuest(env);
  if (!guest) return false;
  // An installed standalone engine is a glibc build like a staged one; anything else is not.
  if (isAbsolutePath(cli)) return existsSync(cli);
  return existsSync(join(guest.linuxDir, cli));
}

/** Absolute on the device, whichever separator the host path happens to use. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

/** Binaries the phone runs natively, which the guest cannot run and must not wrap. The app's own Node is a bionic
 *  build; `omb-guest-chromium` is a wrapper that enters the guest by itself, so wrapping it nests proot inside proot
 *  and proot answers "No such file or directory" for a file that is right there. */
const ANDROID_NATIVE = new Set(["libnodeexec.so", "omb-guest-chromium"]);

/** The command to run for `executable`, wrapped when this is the phone and it is a guest build.
 *  Anything else gets the binary untouched, so every desktop path stays exactly as it was. */
export function guestInvocation(executable: string, args: string[], env: NodeJS.ProcessEnv = process.env): WrappedCommand {
  const guest = androidGuest(env);
  if (!guest || !isAbsolutePath(executable)) return { command: executable, args, env };
  if (ANDROID_NATIVE.has(basename(executable))) return { command: executable, args, env };
  // A command that is already the guest's proot is already inside: wrapping it again nests one proot in another, and
  // that hangs until the caller's deadline instead of failing, which is what froze the browser's live screen.
  if (executable === join(guest.linuxDir, "proot")) return { command: executable, args, env };
  // Only an installed or staged engine is a guest build; the app's own Node is not.
  if (!existsSync(executable)) return { command: executable, args, env };
  return guestCommandFor(guest, executable, args, env);
}

/** Runs `cli` inside the guest: the phone's proot, its rootfs, and the loader it maps binaries with.
 *  A bare name is looked up in the phone's linux dir; an absolute path (a standalone engine under
 *  tools/, say) is bound in beside it, so a download anywhere under the app's data runs the same way. */
export function guestCommandFor(guest: AndroidGuestConfig, cli: string, args: string[], env: NodeJS.ProcessEnv = process.env): WrappedCommand {
  const binary = isAbsolutePath(cli) ? cli : join(guest.linuxDir, cli);
  const binds = ["-b", `${guest.linuxDir}:/host-linux`, "-b", `${guest.tmpDir}:/tmp`];
  if (guest.dataDir) binds.push("-b", `${guest.dataDir}:/data`);
  // The app's own home, at the same name on both sides: the browser engine keeps its managed config under it, and the
  // guest's copy of the engine must read the very file this process wrote.
  const appDirForHome = appFilesDir(guest);
  if (appDirForHome) binds.push("-b", `${appDirForHome}:${appDirForHome}`);
  const home = browserHome(guest, env);
  if (home && home !== appDirForHome) binds.push("-b", `${home}:${home}`);
  // The engine's control socket, also identity-bound: a unix socket path is passed straight to connect(), so a guest
  // that names it differently from this process never reaches the daemon and the call hangs instead of failing.
  const socketDir = (env.AGENT_BROWSER_SOCKET_DIR ?? "").replaceAll("\\", "/");
  if (socketDir && socketDir.startsWith("/") && !binds.includes(`${socketDir}:${socketDir}`)) {
    try { mkdirSync(socketDir, { recursive: true }); } catch {}
    binds.push("-b", `${socketDir}:${socketDir}`);
  }
  // The app folder itself, beside data: the server bundle and its proxies live in files/omb-installed,
  // and a guest engine starts them (the agents MCP). Without this mount their paths mean nothing there.
  const appDir = appFilesDir(guest);
  if (appDir) binds.push("-b", `${appDir}:/app`);
  // A binary outside the linux dir rides its own mount, so the guest can name it at all.
  const inLinux = binary.startsWith(guest.linuxDir);
  let inside = inLinux ? `/host-linux/${binary.slice(guest.linuxDir.length + 1).split(sep).join("/")}` : "/host-tool";
  if (!inLinux) binds.push("-b", `${binary}:/host-tool`);
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
      // A caller that names its own HOME keeps it, since the state the engine keeps there must be found again; the
      // rootfs root is only the default.
      HOME: guestHome(guest, env),
      TMPDIR: "/tmp",
      LD_LIBRARY_PATH: guest.linuxDir,
      PROOT_TMP_DIR: guest.tmpDir,
      PROOT_NO_SECCOMP: "1",
      PROOT_ASSUME_MEMFD_UNSUPPORTED: "1",
      PROOT_LOADER: join(guest.linuxDir, "loader"),
    },
  };
}

/** The path a wrapped engine must use for a host folder.
 *
 *  guestCommandFor binds the app's data dir at /data and the linux dir at /host-linux, so a guest
 *  process cannot see the host path the server hands it: OpenCode was told to work in
 *  /data/user/0/<pkg>/files/data/task-workspaces/… and answered NotFound, failing every turn. A
 *  folder outside those mounts is refused rather than passed through, because the guest would
 *  work somewhere else without saying so.
 *
 *  Returns the input unchanged off the phone, so every desktop path stays exactly as it was. */
export function guestWorkspacePath(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const guest = androidGuest(env);
  if (!guest) return path;
  for (const [host, inside] of guestMounts(guest)) {
    // The phone's paths are POSIX whatever the host running this code uses.
    const normalized = host.replaceAll("\\", "/");
    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
    const candidate = path.replaceAll("\\", "/");
    if (candidate === normalized) return inside;
    if (candidate.startsWith(prefix)) return `${inside}/${candidate.slice(prefix.length)}`;
  }
  return path;
}

/** The inverse of guestWorkspacePath: a path a guest engine names, as this computer has it.
 *
 *  The engine asks the client to read and write files by the only names it knows, which are the
 *  guest's; the server opens them on the host. A path that is already a host path is returned
 *  unchanged: `/data/user/0/<pkg>/files/home` is the phone's own folder, and reading its leading
 *  `/data` as the guest mount rewrote it into `/data/user/0/<pkg>/files/data/user/0/<pkg>/files/home`,
 *  which made every export fail on a folder that cannot be read. Off the phone this is a no-op. */
export function hostWorkspacePath(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const guest = androidGuest(env);
  if (!guest) return path;
  // The phone's own prefix wins: the data mount is only a guest name when the rest does not
  // continue into the real app folder.
  const appRoot = appStorageRoot(guest);
  if (appRoot && (path === appRoot || path.startsWith(`${appRoot}/`))) return path;
  for (const [host, inside] of guestMounts(guest)) {
    if (path === inside) return host;
    if (path.startsWith(`${inside}/`)) return `${host.replace(/\/+$/u, "")}/${path.slice(inside.length + 1)}`;
  }
  return path;
}

/** `/data/user/0/<pkg>/files`, the path Android itself uses, derived from the guest's data folder. */
function appStorageRoot(guest: AndroidGuestConfig): string | null {
  if (!guest.dataDir) return null;
  const marker = "/files/";
  const at = guest.dataDir.indexOf(marker);
  return at < 0 ? null : guest.dataDir.slice(0, at + marker.length - 1);
}

function guestMounts(guest: AndroidGuestConfig): Array<[string, string]> {
  const mounts: Array<[string, string]> = [[guest.linuxDir, "/host-linux"]];
  if (guest.dataDir) mounts.push([guest.dataDir, "/data"]);
  const appDir = appFilesDir(guest);
  if (appDir) mounts.push([appDir, "/app"]);
  // Longest host path first: `files` contains `files/data`, so the data mount must win for its own files.
  return mounts.sort((a, b) => b[0].length - a[0].length);
}

/** The app's `files` folder: the parent of `data`, holding the installed server bundle. */
export function appFilesDir(guest: AndroidGuestConfig): string | null {
  if (!guest.dataDir) return null;
  const normalized = guest.dataDir.replaceAll("\\", "/");
  const cut = normalized.lastIndexOf("/");
  return cut > 0 ? normalized.slice(0, cut) : null;
}

/** The HOME a guest command runs with: the caller's own, named the way the guest sees it, or the rootfs root. */
function guestHome(guest: AndroidGuestConfig, env: NodeJS.ProcessEnv): string {
  const wanted = (env.HOME ?? env.USERPROFILE ?? "").replaceAll("\\", "/");
  if (!wanted) return "/root";
  const translated = guestWorkspacePath(wanted, env);
  // A host path the mounts do not cover cannot be made writable here, so the engine gets the rootfs root instead.
  return translated.startsWith("/") && !translated.startsWith(guest.linuxDir) ? translated : "/root";
}

/** The phone process's own HOME when it sits under the app's `files` folder: what the browser engine builds its config
 *  path from. Null when HOME is elsewhere, so a desktop value is never bound into the guest. */
function browserHome(guest: AndroidGuestConfig, env: NodeJS.ProcessEnv): string | null {
  const home = (env.HOME ?? env.USERPROFILE ?? "").replaceAll("\\", "/");
  const appDir = appFilesDir(guest);
  if (!home || !appDir) return null;
  return home === appDir || home.startsWith(`${appDir}/`) || home === guest.dataDir || home.startsWith(`${guest.dataDir}/`) ? home : null;
}
