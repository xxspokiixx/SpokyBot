#!/bin/bash
# Installs the noVNC packages into an already-built rootfs, without debootstrapping it again. Used to
# correct a build that left them out; scripts/build-android-rootfs.sh carries the same package list.
set -euo pipefail
R=/opt/omb-rootfs-build/rootfs
mkdir -p "$R/dev" "$R/dev/pts" "$R/proc"
mount --bind /dev "$R/dev" 2>/dev/null || true
mount --bind /dev/pts "$R/dev/pts" 2>/dev/null || true
mount -t proc proc "$R/proc" 2>/dev/null || true
DEBIAN_FRONTEND=noninteractive chroot "$R" /bin/bash -c '
  export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  apt-get update -qq 2>&1 | tail -2
  apt-get install -y --no-install-recommends novnc websockify 2>&1 | tail -4
  echo "websockify: $(command -v websockify || echo MISSING)"
  echo "novnc dir: $(ls -d /usr/share/novnc 2>/dev/null || echo MISSING)"
'
umount "$R/proc" 2>/dev/null || true
umount "$R/dev/pts" 2>/dev/null || true
umount "$R/dev" 2>/dev/null || true
