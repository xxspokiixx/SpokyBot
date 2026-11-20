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
import { join, sep } from "node:path";
/** The guest config from the environment the phone's shell sets, or null off the phone.
 *
 *  The shell gives the server the linux dir, the rootfs and the data dir; the tmp dir it only gives
 *  the MCP child, so it is derived here rather than required. Requiring it made this answer null on
 *  the server, and the wrapper never applied. */
export function androidGuest(env) {
    const source = env ?? process.env;
    if (source.OMB_ANDROID_STANDALONE !== "1")
        return null;
    const linuxDir = source.OMB_ANDROID_LINUX_DIR;
    const rootfs = source.OMB_ANDROID_ROOTFS;
    if (!linuxDir || !rootfs)
        return null;
    const tmpDir = source.OMB_ANDROID_TMP_DIR || join(linuxDir, "tmp");
    return { linuxDir, rootfs, tmpDir, ...(source.OMB_ANDROID_DATA_DIR ? { dataDir: source.OMB_ANDROID_DATA_DIR } : {}) };
}
/** Whether this process is a guest engine the phone has to run through proot: a binary staged beside
 *  proot, or a bare name that resolves to one. An absolute path is checked where it points. */
export function needsGuestLoader(cli, env) {
    const guest = androidGuest(env);
    if (!guest)
        return false;
    // An installed standalone engine is a glibc build like a staged one; anything else is not.
    if (isAbsolutePath(cli))
        return existsSync(cli);
    return existsSync(join(guest.linuxDir, cli));
}
/** Absolute on the device, whichever separator the host path happens to use. */
function isAbsolutePath(path) {
    return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}
/** The command to run for `executable`, wrapped when this is the phone and it is a guest build.
 *  Anything else gets the binary untouched, so every desktop path stays exactly as it was. */
export function guestInvocation(executable, args, env = process.env) {
    const guest = androidGuest(env);
    if (!guest || !isAbsolutePath(executable))
        return { command: executable, args, env };
    // Only an installed or staged engine is a guest build; the app's own Node is not.
    if (!existsSync(executable))
        return { command: executable, args, env };
    return guestCommandFor(guest, executable, args, env);
}
/** Runs `cli` inside the guest: the phone's proot, its rootfs, and the loader it maps binaries with.
 *  A bare name is looked up in the phone's linux dir; an absolute path (a standalone engine under
 *  tools/, say) is bound in beside it, so a download anywhere under the app's data runs the same way. */
export function guestCommandFor(guest, cli, args, env = process.env) {
    const binary = isAbsolutePath(cli) ? cli : join(guest.linuxDir, cli);
    const binds = ["-b", `${guest.linuxDir}:/host-linux`, "-b", `${guest.tmpDir}:/tmp`];
    if (guest.dataDir)
        binds.push("-b", `${guest.dataDir}:/data`);
    // A binary outside the linux dir rides its own mount, so the guest can name it at all.
    const inLinux = binary.startsWith(guest.linuxDir);
    let inside = inLinux ? `/host-linux/${binary.slice(guest.linuxDir.length + 1).split(sep).join("/")}` : "/host-tool";
    if (!inLinux)
        binds.push("-b", `${binary}:/host-tool`);
    for (const file of ["passwd", "group"]) {
        const host = join(guest.rootfs, "etc", file);
        if (existsSync(host))
            binds.push("-b", `${host}:/etc/${file}`);
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
