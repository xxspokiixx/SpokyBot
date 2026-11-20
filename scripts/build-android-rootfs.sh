#!/bin/bash
# Builds the phone's Linux rootfs from a clean Debian bookworm debootstrap, for aarch64.
#
# Why this exists: the archive this replaces carried usr/bin/bash, cat, ls, env and sh as symlinks
# pointing at themselves — the binaries were never in it — so every shell command failed with "not
# found", the desktop could not start and ssh could not run. Patching those five on the device did not
# survive a rebuild, because the archive is re-extracted whenever the build changes.
#
# The output is a tar.gz that server/container-computer.ts extracts into files/linux/rootfs and runs
# under proot with -R (fake root, host /dev, /proc and /sys bound in). Everything the phone's two
# destinations need is installed here, from the release the phone runs.
#
# Run it as root in WSL (or any Linux with qemu-user-static):
#   wsl -d Ubuntu -u root -- bash scripts/build-android-rootfs.sh
set -euo pipefail

SUITE=${SUITE:-bookworm}
MIRROR=${MIRROR:-http://deb.debian.org/debian}
WORK=${WORK:-/opt/omb-rootfs-build}
TARGET="$WORK/rootfs"
OUT=${OUT:-/mnt/c/Users/xxspokiixx/Documents/GitHub/SpokyBot/android-test/runtime/android-arm64/linux/rootfs.tar.gz}

log() { echo "[rootfs] $*"; }

log "work dir $WORK"
mkdir -p "$WORK"
rm -rf "$TARGET"
mkdir -p "$TARGET/usr/bin"

if [ ! -e /usr/bin/qemu-aarch64-static ] && [ -e /usr/bin/qemu-aarch64 ]; then
  ln -sf /usr/bin/qemu-aarch64 /usr/bin/qemu-aarch64-static
fi
install -m 0755 /usr/bin/qemu-aarch64-static "$TARGET/usr/bin/qemu-aarch64-static"

log "debootstrap $SUITE arm64"
debootstrap --arch=arm64 --variant=minbase --foreign \
  --include=ca-certificates \
  "$SUITE" "$TARGET" "$MIRROR"

log "second stage (arm64 under qemu)"
chroot "$TARGET" /debootstrap/debootstrap --second-stage

log "sources, and the packages the phone needs"
cat > "$TARGET/etc/apt/sources.list" <<EOF
deb $MIRROR $SUITE main
deb $MIRROR $SUITE-updates main
deb $MIRROR-security $SUITE-security main
EOF

export DEBIAN_FRONTEND=noninteractive
chroot "$TARGET" /bin/bash -c '
set -e
apt-get update
apt-get install -y --no-install-recommends \
  bash dash coreutils \
  python3 \
  openssh-client openssh-server \
  xvfb x11vnc xfce4 xfce4-terminal xterm \
  openbox dbus-x11 novnc websockify \
  x11-utils x11-xserver-utils x11-apps \
  fonts-dejavu-core \
  procps psmisc util-linux \
  tar gzip xz-utils zstd \
  curl ca-certificates \
  tzdata locales
apt-get clean
rm -rf /var/lib/apt/lists/*
'

log "the guest needs a passwd name for the app uid, and a home that exists"
chroot "$TARGET" /bin/bash -c '
set -e
grep -q "^android:" /etc/passwd || echo "android:x:10307:10307:Android:/root:/bin/bash" >> /etc/passwd
grep -q "^android:" /etc/group || echo "android:x:10307:" >> /etc/group
mkdir -p /root /tmp /work /host-linux /data
chmod 1777 /tmp
'

log "an empty guest /dev: proot -R binds the host one over it"
mkdir -p "$TARGET/dev"
rm -rf "$TARGET/dev"/*

log "checking every program this build promises"
chroot "$TARGET" /bin/bash -c '
set -e
for p in bash sh dash cat ls env head tail sed awk grep cut sort wc date df mkdir rm cp mv chmod ln touch sleep ssh scp xterm Xvfb x11vnc xwd python3; do
  if ! command -v "$p" >/dev/null 2>&1; then echo "MISSING: $p"; exit 1; fi
done
echo "all programs present"
ls -l /bin/bash /usr/bin/ssh /usr/bin/xterm | sed "s|^|  |"
'

log "tar the tree, without the qemu copy that only the build needed"
rm -f "$TARGET/usr/bin/qemu-aarch64-static"
mkdir -p "$(dirname "$OUT")"
tar -C "$TARGET" -czf "$OUT" .
log "wrote $OUT ($(du -h "$OUT" | cut -f1))"
