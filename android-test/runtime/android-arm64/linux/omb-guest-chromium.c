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
    // lane existed, so the variable can be missing. This binary knows where it lives:
    // /data/user/0/<package>/files/linux/omb-guest-chromium, so its own path names the
    // linux dir. A fixed path here pointed at another package and read as
    // "exec of proot failed" on every launch.
    const char *linux_dir = getenv("OMB_ANDROID_LINUX_DIR");
    static char own_dir[4096];
    if (!linux_dir || !*linux_dir) {
        ssize_t n = readlink("/proc/self/exe", own_dir, sizeof own_dir - 1);
        if (n > 0) {
            own_dir[n] = 0;
            char *slash = strrchr(own_dir, '/');
            if (slash) *slash = 0;
            linux_dir = own_dir;
        }
    }
    if (!linux_dir || !*linux_dir) linux_dir = "/data/user/0/com.openmausbot.test/files/linux";
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
    // One spare slot each for the port switch that replaces a dropped pipe and the two switches added below.
    int total = 15 + argc + 1;
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
    int dropped_pipe = 0, has_no_sandbox = 0, has_shm_off = 0;
    for (int a = 1; a < argc && i < total - 1; a++) {
        // proot cannot carry fd 3 and 4, so Chrome aborts on --remote-debugging-pipe with
        // "Remote debugging pipe file descriptors are not open" — and the switch wins over the port even
        // when both are passed. agent-browser always adds it, so it is dropped and a loopback port named.
        if (strcmp(argv[a], "--remote-debugging-pipe") == 0) {
            dropped_pipe = 1;
            continue;
        }
        if (strcmp(argv[a], "--no-sandbox") == 0) has_no_sandbox = 1;
        if (strcmp(argv[a], "--disable-dev-shm-usage") == 0) has_shm_off = 1;
        nargv[i++] = argv[a];
    }
    if (dropped_pipe) nargv[i++] = (char *)"--remote-debugging-port=0";
    // Chrome's sandbox needs user namespaces, which proot does not provide: it dies in the zygote before
    // the DevTools port is written. agent-browser does not pass this itself on the paths it takes here.
    if (!has_no_sandbox) nargv[i++] = (char *)"--no-sandbox";
    // proot binds the host's /dev, which has no shm: Chrome aborts unless it uses a temp file instead.
    if (!has_shm_off) nargv[i++] = (char *)"--disable-dev-shm-usage";
    nargv[i] = NULL;

    execv(proot, nargv);
    fail("omb-guest-chromium: exec of proot failed\n");
}
