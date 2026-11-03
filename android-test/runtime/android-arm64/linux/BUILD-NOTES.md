# BUILD-NOTES â€” phone "local desktop" (Debian arm64 rootfs + proot), assembled locally

**Status: BUILT + ON-DEVICE VERIFIED** (Chromium headless renders real pages;
bash/python/git/curl work; DNS from the active network). All sources downloaded
and assembled on this host's WSL2 Ubuntu; no git commits/pushes anywhere; only
outputs copied here.

## Deliverables (this folder)

| File | Bytes | sha256 |
|---|---|---|
| `rootfs.tar.gz` | 379,887,566 | rebuild-stamped by the build script below |
| `proot` | 258,576 | `0b9b0448247631889a20430f5fd643975208ca06216eec7fa3204b5af2d5b91b` |
| `loader` | 18,136 | `1da54355333cca3fb6ee10e3b82a24df24fb230c99241ce83809bf9e240609b5` |
| `libtalloc.so.2` | 33,592 | `742b438c4d09e276985a61d44164c9de207b6d8cc268f3018cb3001961bcb309` |
| `libandroid-shmem.so` | 14,432 | `84475798e07c8174dbbfaec70a827fdb02f19ffa69a589380c13e7507fd0e731` |
| `omb-guest-chromium(.c)` | 8,896 | NDK r30 PIE wrapper: re-execs the harness's Chrome argv through proot |

The rootfs tarball is rebuilt by the script; its sha256 is printed by each run.

## Why Debian (the Alpine detour)

The first guest was Alpine 3.22 (musl): its chromium **runs** (`--version`
works through proot) but the headless browser process dies with **SIGTRAP** at
startup â€” Alpine-specific, gone entirely with Debian's glibc build. Debian is
also the combo Termux's proot-distro community actually runs.

## Three Android facts the rootfs had to satisfy (all fixed in the builder)

1. **toybox tar refuses absolute-target symlinks** (`/etc/localtime â†’ /usr/...`
   â†’ "not under <dir>" aborts the whole extraction). All absolute symlinks are
   rewritten to relative at build time (85 in this tree).
2. **Android denies `link(2)` in app storage** (the same fact that forced the
   atomic-publish fallback in the harness), so tar's hard-link entries (mesa's
   driver shims) can never extract: each hard-link group becomes one real file
   plus relative symlinks (45 links).
3. **The docker layer's `/bin` and `/lib` are plain directories** while the
   binaries and glibc interpreter live under `/usr` (`PT_INTERP
   /lib/ld-linux-aarch64.so.1`): compat symlinks are added for the paths the
   lane invokes (`/bin/bash`, `/bin/sh`, `/bin/env`, `/bin/ls`, `/bin/cat`,
   `/lib/ld-linux-aarch64.so.1`).

## Sources

- **Rootfs**: docker.io/library/debian:bookworm arm64 layer (pulled directly
  from the registry over HTTP â€” no docker, no root), extended with the apt
  dependency closure of `chromium python3 git curl fonts-liberation
  fonts-dejavu-core fontconfig` resolved against the layer's own dpkg status
  and unpacked with `dpkg-deb -x` (204 debs).
- **proot/loader/libtalloc/libandroid-shmem**: Termux builds (bionic, PIE),
  see the previous sections.
- **qemu fallback** (kept, unstaged): see its own section below.

## Reproduce

WSL: `python3 /mnt/c/Users/xxspokiixx/AppData/Local/Temp/opencode/build-debian-rootfs.py`
(working dir `~/debianrootfs`; downloads cached there).

## On-device usage (NodeHostService extracts to `<filesDir>/linux/`)

```
files/linux/rootfs/            <- rootfs.tar.gz, extracted once (tar via /system/bin)
files/linux/proot              <- exec'd directly (targetSdk 28 unlocks app-data exec)
files/linux/loader             <- proot's guest-exec helper; MUST keep its exec bit
files/linux/omb-guest-chromium  <- OMB_CHROME_PATH: re-execs Chrome argv through proot
files/linux/libtalloc.so.2     <- found via LD_LIBRARY_PATH=files/linux
files/linux/libandroid-shmem.so
```

A command runs as:

```
LD_LIBRARY_PATH=<filesDir>/linux \
PROOT_TMP_DIR=<filesDir>/linux/tmp PROOT_NO_SECCOMP=1 \
PROOT_ASSUME_MEMFD_UNSUPPORTED=1 PROOT_LOADER=<filesDir>/linux/loader \
  <filesDir>/linux/proot -R <filesDir>/linux/rootfs \
  -b <filesDir>/workspace:/work -w /work /bin/bash -lc '<command>'
```

The browser runs through `omb-guest-chromium` (NDK r30, bionic PIE), which the
harness's launcher execs verbatim with Chrome flags; the wrapper adds the
proot chain, an identity bind of the app's files dir (so `--user-data-dir`
and HOME resolve inside the guest), a writable `/dev/shm`, and
`XDG_RUNTIME_DIR` for Chrome's ProcessSingleton. DNS: the service rewrites
`rootfs/etc/resolv.conf` at every boot with the active network's resolvers
plus public fallbacks (the guest shares the kernel network; only the
nameservers were ever missing).

## Verified on-device (Samsung SM-P610, Android 16, 2026-10-24)

- `proot â€¦ /bin/bash -lc 'uname -a; python3 --version; git --version'` â†’
  `aarch64 GNU/Linux / Python 3.11.2 / git 2.39.5` (app-domain self-test).
- DNS + TLS: `curl https://example.com` â†’ 200 inside the guest.
- **Browser**: `omb-guest-chromium --headless=new --dump-dom https://example.com`
  â†’ the full rendered DOM of the real page (Chromium 156.0.8078.47). The
  dbus/udev/inotify errors in its stderr are benign container-init noise.

## Fallback kept but unstaged: proot `-q` + qemu-aarch64

`qemu/` holds qemu-user-aarch64 1:11.1.2 (Termux build, PIE + bionic) and its
23-library NEEDED closure (~16.7 MB, resolved by the fetch/trim scripts in
Temp). With `PROOT_FORCE_FOREIGN_BINARY=1`, proot routes guest execs through
`-q <qemu>`. Working for shell guests in isolation, but its bionic libraries
conflict with a musl/glibc guest view unless the Android system trees are
bound in â€” not needed since the loader path works. Revisit only if a future
Android refuses the ET_EXEC loader in the app domain.

