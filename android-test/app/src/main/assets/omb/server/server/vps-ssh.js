// An ssh_config and an `ssh` shim that add connection sharing and fail-fast timeouts to every VPS command, whatever the user's alias sets.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
export const VPS_SSH_DIR = "ssh";
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
/** A Unix socket path is capped near 104 bytes, and OpenSSH appends a temporary suffix, so the
 * directory that hosts the connection-sharing socket has to be short. Sharing is off on Android,
 * where link(2) is denied in app storage, so this only has to satisfy a desktop's sandbox paths. */
function controlPaths(sshDir) {
    if (Buffer.byteLength(join(sshDir, `cm-${"0".repeat(40)}`)) <= 80)
        return sshDir;
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const id = createHash("sha256").update(resolve(sshDir)).digest("hex").slice(0, 12);
    return join("/tmp", `omb-ssh-${uid}-${id}`);
}
function findExecutable(name, pathValue, exclude) {
    for (const dir of pathValue.split(delimiter)) {
        if (!dir || dir === exclude)
            continue;
        const candidate = join(dir, name);
        try {
            const stat = statSync(candidate);
            if (stat.isFile() && (stat.mode & 0o111) !== 0)
                return candidate;
        }
        catch { }
    }
    return null;
}
function writeIfChanged(path, content, mode) {
    try {
        if (readFileSync(path, "utf8") === content) {
            chmodSync(path, mode);
            return;
        }
    }
    catch { }
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, content, { mode });
    renameSync(temp, path);
}
/** The staged identities the asset extractor leaves world-readable, which OpenSSH refuses to use. */
function stagedIdentities(sshDir) {
    return ["id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"]
        .map((name) => join(sshDir, name))
        .filter((path) => existsSync(path))
        .map((path) => {
        // A key lands with its copied mode, and OpenSSH rejects one any group or other can read.
        try {
            chmodSync(path, 0o600);
        }
        catch { /* a key the app does not own */ }
        return path;
    });
}
/** ssh keeps the first value it sees, so the person's file goes first; -F skips the system file, so it goes last. */
export function vpsSshConfigText(controlSocket, knownHosts, shareConnection, userConfig = join(homedir(), ".ssh", "config"), systemConfig = "/etc/ssh/ssh_config", identities = []) {
    const controlPath = `${controlSocket.replace(/%/g, "%%").replace(/\/+$/, "")}/cm-%C`;
    return [
        "# Written by SpokyBot for its VPS computer connections. Do not edit;",
        "# it is regenerated. Your own ~/.ssh/config is included first and wins.",
        ...(existsSync(userConfig) ? [`Include ${JSON.stringify(userConfig)}`] : []),
        "Host *",
        // Sharing installs its listener with link(2), and Android denies link in app storage, so the
        // phone's guest could never open the control socket and every VPS command died on it. One
        // connection per command still works; sharing is kept everywhere the platform allows it.
        ...(shareConnection
            ? ["  ControlMaster auto", `  ControlPath ${JSON.stringify(controlPath)}`, "  ControlPersist 10m"]
            : ["  ControlMaster no"]),
        "  ServerAliveInterval 15",
        "  ServerAliveCountMax 3",
        "  ConnectTimeout 10",
        // OpenSSH asks about a host key it has not seen and nothing can answer: these commands run
        // without a terminal, so the first connection to a newly configured VPS stopped dead with
        // "Host key verification failed". accept-new records the key and still refuses one that changed.
        "  StrictHostKeyChecking accept-new",
        `  UserKnownHostsFile ${JSON.stringify(knownHosts)}`,
        // Nothing reads ~/.ssh inside the guest, and the phone's app storage is not a home ssh looks
        // in, so the config names the staged keys itself. IdentityFile never prompts: naming them all
        // in one connection is what makes a key found rather than guessed per host.
        ...identities.map((path) => `  IdentityFile ${JSON.stringify(path)}`),
        ...(existsSync(systemConfig) ? [`Include ${JSON.stringify(systemConfig)}`] : []),
        "",
    ].join("\n");
}
/** Windows OpenSSH has no ControlMaster, so there nothing changes. */
export function prepareVpsSsh(dataDir, pathValue, platform = process.platform) {
    if (platform === "win32")
        return { configPath: null, path: pathValue };
    const sshDir = join(dataDir, VPS_SSH_DIR);
    const binDir = join(sshDir, "bin");
    mkdirSync(binDir, { recursive: true, mode: 0o700 });
    chmodSync(sshDir, 0o700);
    const configPath = join(sshDir, "config");
    const share = platform !== "android";
    const control = controlPaths(sshDir);
    if (share) {
        try {
            mkdirSync(control, { recursive: true, mode: 0o700 });
            const stat = lstatSync(control);
            const uid = typeof process.getuid === "function" ? process.getuid() : 0;
            if (!stat.isDirectory() || (uid !== 0 && stat.uid !== uid)) {
                throw new Error("The VPS SSH control directory is not private to this user");
            }
            chmodSync(control, 0o700);
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
        }
    }
    // Created empty rather than left absent: ssh refuses a UserKnownHostsFile it cannot open,
    // and the app owns this file, so it never writes into the person's own one.
    const knownHosts = join(sshDir, "known_hosts");
    if (!existsSync(knownHosts))
        writeIfChanged(knownHosts, "", 0o600);
    writeIfChanged(configPath, vpsSshConfigText(control, knownHosts, share, undefined, undefined, stagedIdentities(sshDir)), 0o600);
    const realSsh = findExecutable("ssh", pathValue, binDir);
    if (!realSsh)
        return { configPath, path: pathValue };
    const shim = [
        "#!/bin/sh",
        "# Written by SpokyBot. docker's SSH transport finds this ssh first, so every VPS command",
        "# uses this config whether or not the alias says so.",
        `exec ${shellQuote(realSsh)} -F ${shellQuote(configPath)} "$@"`,
        "",
    ].join("\n");
    writeIfChanged(join(binDir, "ssh"), shim, 0o700);
    return { configPath, path: `${binDir}${delimiter}${pathValue}` };
}
