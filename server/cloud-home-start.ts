// Entry point of the OMB Cloud Pro home image (deploy/fly/Dockerfile).
//
// Starts as root, hands a fresh Fly volume (mounted root-owned at /data) to
// the unprivileged `maus` user, and stays a small root supervisor of two
// children that run as `maus`: the OpenMausBot server on 127.0.0.1:8799
// (and its webhook receiver on :8800) and the Caddy edge on 0.0.0.0:8080.
// The edge is the only listener the network can reach, and it always
// forwards with X-Forwarded-*, so request-auth.ts never grants a remote
// request loopback trust. If either child exits, both stop and the machine
// restarts; the one exception is the server asking to be started again
// after a restore.
//
// The machine's secrets (the signing secret, the relay tokens) arrive as
// this process's environment. No child's environment ever carries them:
// /proc/<pid>/environ keeps a process's starting environment, readable by
// anything running as the same user (an engine's shell). The server gets
// them over an inherited pipe it reads once and closes (cloud-home.ts
// takeCloudSecrets). This process stays root, so its own environment and
// memory are out of `maus`'s reach.
import { spawn, type ChildProcess } from "node:child_process";
import { chownSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CLOUD_HOME_RESTART_EXIT_CODE, CLOUD_SECRETS_FD_ENV, cloudHomeConfiguration, cloudHomeHost, cloudHomeSecrets, prepareCloudHomeVolume,
  withoutCloudSecrets, withoutIgnoredCloudKeys, type CloudHomeConfig,
} from "./cloud-home.ts";

const SERVICE_USER = "maus";
/** The descriptor the server reads its secrets from. */
const SECRETS_FD = 3;

/** uid/gid from /etc/passwd; Node has no getpwnam. */
export function passwdIds(passwd: string, name: string): { uid: number; gid: number } | null {
  for (const line of passwd.split("\n")) {
    const [user, , uid, gid] = line.split(":");
    if (user === name && /^\d+$/.test(uid ?? "") && /^\d+$/.test(gid ?? "")) return { uid: Number(uid), gid: Number(gid) };
  }
  return null;
}

/** The server child's environment: the operator's contract plus fixed
 * ports and paths (Linux paths inside the image, so POSIX joins on every
 * host that builds them, tests included), never a platform gateway's settings
 * and never a secret (`secrets`, handed over the pipe instead). The edge
 * child gets only what it needs to route. */
export function cloudHomeChildEnvironments(config: CloudHomeConfig, env: NodeJS.ProcessEnv, home: string) {
  const server: NodeJS.ProcessEnv = {
    ...withoutCloudSecrets(withoutIgnoredCloudKeys(env)), HOME: home, OMB_DATA_DIR: env.OMB_DATA_DIR || posix.join(home, ".openmausbot"),
    OMB_PORT: "8799", OMB_WEBHOOK_PORT: "8800", OMB_PUBLIC_URL: config.publicOrigin,
    OMB_WEBHOOK_PUBLIC_URL: env.OMB_WEBHOOK_PUBLIC_URL || config.publicOrigin,
    [CLOUD_SECRETS_FD_ENV]: String(SECRETS_FD),
  };
  const edge: NodeJS.ProcessEnv = {
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp/omb-edge",
    XDG_DATA_HOME: "/tmp/omb-edge/data", XDG_CONFIG_HOME: "/tmp/omb-edge/config",
    OMB_CLOUD_PUBLIC_HOST: cloudHomeHost(config),
  };
  return { server, edge, secrets: cloudHomeSecrets(env) };
}

/** Start the server with its secrets on an inherited pipe (never its
 * environment), as `ids` when given. The pipe is written and closed at once;
 * nothing else is ever sent on it. */
export function spawnWithSecrets(command: string, args: string[], env: NodeJS.ProcessEnv, secrets: Record<string, string>,
  ids?: { uid: number; gid: number } | null): ChildProcess {
  const child = spawn(command, args, { env, stdio: ["inherit", "inherit", "inherit", "pipe"], ...(ids ? { uid: ids.uid, gid: ids.gid } : {}) });
  const pipe = child.stdio[SECRETS_FD] as NodeJS.WritableStream | null;
  pipe?.on("error", () => { /* the child is gone; its exit is handled by the caller */ });
  pipe?.end(JSON.stringify(secrets));
  return child;
}

/** What the launcher does when the server child exits: start it again only
 * when it asked to (a committed restore), and only a few times in a row. */
export function serverExitAction(code: number | null, stopping: boolean, restarts: number): "restart" | "stop" {
  return !stopping && code === CLOUD_HOME_RESTART_EXIT_CODE && restarts < 5 ? "restart" : "stop";
}

export function startCloudHome(env: NodeJS.ProcessEnv = process.env) {
  process.umask(0o077);
  const config = cloudHomeConfiguration(env);
  if (!config) throw new Error("This image runs an OMB Cloud home machine; set its boot contract (docs/cloud-pro.md).");
  // Logged here once: the server child never sees what they are about.
  for (const warning of config.warnings) console.warn(`cloud home: ${warning}`);
  const home = env.HOME || "/data";
  // Who the children run as: `maus` when this starts as root (the image),
  // else whoever started it (a test, a dev machine).
  let ids: { uid: number; gid: number } | null = null;
  if (process.getuid?.() === 0) {
    ids = passwdIds(readFileSync("/etc/passwd", "utf8"), SERVICE_USER);
    if (!ids) throw new Error(`The ${SERVICE_USER} user is missing from this image.`);
    // A new volume is a root-owned mount point. Only the mount point itself
    // changes owner; anything inside keeps the owner it already has.
    const stat = statSync(home);
    if (stat.uid !== ids.uid || stat.gid !== ids.gid) chownSync(home, ids.uid, ids.gid);
    process.setgroups?.([]);
    // The volume is prepared as `maus`, so what it creates is theirs.
    process.setegid!(ids.gid);
    process.seteuid!(ids.uid);
    try { prepareCloudHomeVolume(home, config.machineId); } finally {
      process.seteuid!(0);
      process.setegid!(0);
    }
  } else {
    prepareCloudHomeVolume(home, config.machineId);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const { server, edge, secrets } = cloudHomeChildEnvironments(config, env, home);
  const children: ChildProcess[] = [];
  let stopping = false;
  const stop = (failed: boolean) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = failed ? 1 : 0;
    for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
    const force = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); }, 20_000);
    force.unref();
  };
  const watch = (child: ChildProcess, again?: (code: number | null) => boolean) => {
    children.push(child);
    child.once("error", () => stop(true));
    child.once("exit", (code) => {
      children.splice(children.indexOf(child), 1);
      if (!again?.(code)) stop(true);
    });
  };
  let restarts = 0;
  const runServer = () => watch(spawnWithSecrets(process.execPath, [join(here, "index.js")], server, secrets, ids), (code) => {
    if (serverExitAction(code, stopping, restarts) !== "restart") return false;
    restarts++;
    runServer();
    return true;
  });
  runServer();
  watch(spawn(env.OMB_CLOUD_EDGE_BIN || "/usr/local/bin/caddy", ["run", "--config", env.OMB_CLOUD_EDGE_CONFIG || "/app/cloud/Caddyfile", "--adapter", "caddyfile"],
    { env: edge, stdio: "inherit", ...(ids ? { uid: ids.uid, gid: ids.gid } : {}) }));
  process.once("SIGTERM", () => stop(false));
  process.once("SIGINT", () => stop(false));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { startCloudHome(); } catch (error) {
    console.error(`Cloud home startup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
