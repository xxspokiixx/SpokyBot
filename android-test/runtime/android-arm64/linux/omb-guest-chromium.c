// omb-guest-chromium — the phone shell's browser entry point.
// The harness's browser launcher names this file through OMB_CHROME_PATH and
// execs it with Chrome's flags; a single executable cannot express the
// proot+loader chain Android needs (the guest's chromium resolves its musl
// interpreter only inside the rootfs), so this wrapper re-execs into the
// guest and passes argv through verbatim.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char proot[4096];
static char rootfs[4096];
static char loader[4096];
static char files_dir[4096];
static char shm[4096];

static void fail(const char *message) {
    (void)write(2, message, strlen(message));
    _exit(127);
}

int main(int argc, char **argv) {
    // The harness's browser runtime env passes an allowlist that grew before this
    // lane existed; the app's files dir is stable across installs, so it stands in.
    const char *linux_dir = getenv("OMB_ANDROID_LINUX_DIR");
    if (!linux_dir || !*linux_dir) linux_dir = "/data/user/0/com.openmausbot.localtest/files/linux";
    snprintf(proot, sizeof proot, "%s/proot", linux_dir);
    snprintf(rootfs, sizeof rootfs, "%s/rootfs", linux_dir);
    snprintf(loader, sizeof loader, "%s/loader", linux_dir);
    snprintf(shm, sizeof shm, "%s/tmp:/dev/shm", linux_dir);
    snprintf(files_dir, sizeof files_dir, "%s", linux_dir);
    char *cut = strstr(files_dir, "/linux");
    if (cut && cut == files_dir + strlen(files_dir) - 6) *cut = 0;
    else files_dir[0] = 0;

    char ld_path[8192];
    snprintf(ld_path, sizeof ld_path, "%s", linux_dir);
    setenv("LD_LIBRARY_PATH", ld_path, 1);
    char tmp_dir[4096];
    snprintf(tmp_dir, sizeof tmp_dir, "%s/tmp", linux_dir);
    setenv("PROOT_TMP_DIR", tmp_dir, 1);
    // Chrome's ProcessSingleton refuses to start without a runtime dir for its
    // socket; the launcher's env has none, and every path under the app's
    // files dir resolves inside the guest through the identity bind.
    setenv("XDG_RUNTIME_DIR", tmp_dir, 1);
    setenv("TMPDIR", tmp_dir, 1);
    setenv("PROOT_NO_SECCOMP", "1", 1);
    setenv("PROOT_ASSUME_MEMFD_UNSUPPORTED", "1", 1);
    setenv("PROOT_LOADER", loader, 1);

    // proot, the rootfs, an identity bind so Chrome's host-shaped paths
    // (user-data-dir, download dir, HOME) resolve inside the guest too, and
    // a writable /dev/shm, then the guest binary with the launcher's argv.
    int total = 12 + argc + 1;
    char **nargv = calloc(total, sizeof(char *));
    if (!nargv) fail("omb-guest-chromium: out of memory\n");
    int i = 0;
    nargv[i++] = proot;
    nargv[i++] = (char *)"-R";
    nargv[i++] = rootfs;
    nargv[i++] = (char *)"-b";
    nargv[i++] = shm;
    if (files_dir[0]) {
        char *identity = malloc(2 * strlen(files_dir) + 2);
        if (!identity) fail("omb-guest-chromium: out of memory\n");
        sprintf(identity, "%s:%s", files_dir, files_dir);
        nargv[i++] = (char *)"-b";
        nargv[i++] = identity;
    }
    nargv[i++] = (char *)"/usr/lib/chromium/chromium";
    for (int a = 1; a < argc && i < total - 1; a++) nargv[i++] = argv[a];
    nargv[i] = NULL;

    execv(proot, nargv);
    fail("omb-guest-chromium: exec of proot failed\n");
}
