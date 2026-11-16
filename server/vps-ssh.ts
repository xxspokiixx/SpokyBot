// An ssh_config and an `ssh` shim that add connection sharing and fail-fast timeouts to every VPS command, whatever the user's alias sets.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export const VPS_SSH_DIR = "ssh";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** A Unix socket path is capped near 104 bytes, and OpenSSH appends a temporary suffix, so the
 * directory that hosts the connection-sharing socket has to be short. It is not always the same
 * path for both sides: on Android the ssh that runs is the guest's, and it sees the app's
 * linux/tmp as `/tmp`, while the host creates the directory at its own path. */
function controlPaths(sshDir: string, dataDir: string | undefined, platform: NodeJS.Platform): { host: string; client: string } {
  const short = Buffer.byteLength(join(sshDir, `cm-${"0".repeat(40)}`)) <= 80;
  if (short) return { host: sshDir, client: sshDir };
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const id = createHash("sha256").update(resolve(sshDir)).digest("hex").slice(0, 12);
  // The guest's /tmp is the app's linux dir tmp, and it is four characters long: well inside
  // the socket path limit, unlike every path in the app's sandbox.
  const linuxDir = platform === "android" ? process.env.OMB_ANDROID_LINUX_DIR : undefined;
  if (platform === "android" && linuxDir) {
    // The client path is built by hand: the ssh that reads this config is the guest's, and it
    // wants POSIX separators even when the host that writes the file runs Windows.
    return {
      host: join(linuxDir, "tmp", `omb-ssh-${id}`),
      client: `/tmp/omb-ssh-${id}`,
    };
  }
  // Android apps cannot write to the host /tmp, so the socket lands in the data dir; the client
  // sees the same path there, and a desktop sees /tmp for both.
  const host = platform === "android" && dataDir
    ? join(dataDir, `omb-ssh-${uid}-${id}`)
    : join("/tmp", `omb-ssh-${uid}-${id}`);
  return { host, client: host };
}

function findExecutable(name: string, pathValue: string, exclude: string): string | null {
  for (const dir of pathValue.split(delimiter)) {
    if (!dir || dir === exclude) continue;
    const candidate = join(dir, name);
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return candidate;
    } catch {}
  }
  return null;
}

function writeIfChanged(path: string, content: string, mode: number): void {
  try { if (readFileSync(path, "utf8") === content) { chmodSync(path, mode); return; } } catch {}
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode });
  renameSync(temp, path);
}

/** ssh keeps the first value it sees, so the person's file goes first; -F skips the system file, so it goes last. */
export function vpsSshConfigText(
  controlSocket: string,
  knownHosts: string,
  userConfig = join(homedir(), ".ssh", "config"),
  systemConfig = "/etc/ssh/ssh_config",
): string {
  const controlPath = `${controlSocket.replace(/%/g, "%%").replace(/\/+$/, "")}/cm-%C`;
  return [
    "# Written by OpenMausBot for its VPS computer connections. Do not edit;",
    "# it is regenerated. Your own ~/.ssh/config is included first and wins.",
    ...(existsSync(userConfig) ? [`Include ${JSON.stringify(userConfig)}`] : []),
    "Host *",
    "  ControlMaster auto",
    `  ControlPath ${JSON.stringify(controlPath)}`,
    "  ControlPersist 10m",
    "  ServerAliveInterval 15",
    "  ServerAliveCountMax 3",
    "  ConnectTimeout 10",
    // OpenSSH asks about a host key it has not seen and nothing can answer: these commands run
    // without a terminal, so the first connection to a newly configured VPS stopped dead with
    // "Host key verification failed". accept-new records the key and still refuses one that changed.
    "  StrictHostKeyChecking accept-new",
    `  UserKnownHostsFile ${JSON.stringify(knownHosts)}`,
    ...(existsSync(systemConfig) ? [`Include ${JSON.stringify(systemConfig)}`] : []),
    "",
  ].join("\n");
}

export interface VpsSshSetup {
  configPath: string | null;
  path: string;
}

/** Windows OpenSSH has no ControlMaster, so there nothing changes. */
export function prepareVpsSsh(dataDir: string, pathValue: string, platform: NodeJS.Platform = process.platform): VpsSshSetup {
  if (platform === "win32") return { configPath: null, path: pathValue };
  const sshDir = join(dataDir, VPS_SSH_DIR);
  const binDir = join(sshDir, "bin");
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  chmodSync(sshDir, 0o700);
  const configPath = join(sshDir, "config");
  const control = controlPaths(sshDir, dataDir, platform);
  try {
    mkdirSync(control.host, { recursive: true, mode: 0o700 });
    const stat = lstatSync(control.host);
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    if (!stat.isDirectory() || (uid !== 0 && stat.uid !== uid)) {
      throw new Error("The VPS SSH control directory is not private to this user");
    }
    chmodSync(control.host, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Created empty rather than left absent: ssh refuses a UserKnownHostsFile it cannot open,
  // and the app owns this file, so it never writes into the person's own one.
  const knownHosts = join(sshDir, "known_hosts");
  if (!existsSync(knownHosts)) writeIfChanged(knownHosts, "", 0o600);
  writeIfChanged(configPath, vpsSshConfigText(control.client, knownHosts), 0o600);
  const realSsh = findExecutable("ssh", pathValue, binDir);
  if (!realSsh) return { configPath, path: pathValue };
  const shim = [
    "#!/bin/sh",
    "# Written by OpenMausBot. docker's SSH transport finds this ssh first, so",
    "# every VPS command shares one connection whether or not the alias says so.",
    `exec ${shellQuote(realSsh)} -F ${shellQuote(configPath)} "$@"`,
    "",
  ].join("\n");
  writeIfChanged(join(binDir, "ssh"), shim, 0o700);
  return { configPath, path: `${binDir}${delimiter}${pathValue}` };
}
