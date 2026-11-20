#!/bin/bash
# Packs the built rootfs into the archive the phone extracts, after undoing what only the build needed:
# the qemu binary used to run arm64 code on the build host, and any scratch files.
set -euo pipefail
WORK=${WORK:-/opt/omb-rootfs-build}
R="$WORK/rootfs"
OUT=${OUT:-/mnt/c/Users/xxspokiixx/Documents/GitHub/SpokyBot/android-test/runtime/android-arm64/linux/rootfs.tar.gz}

umount "$R/proc" 2>/dev/null || true
umount "$R/dev/pts" 2>/dev/null || true
umount "$R/dev" 2>/dev/null || true
rm -f "$R/usr/bin/qemu-aarch64-static"
rm -f "$R/root/inst.sh"
rm -rf "$R/var/lib/apt/lists"/* 2>/dev/null || true
rm -rf "$R/var/cache/apt"/* 2>/dev/null || true

missing=""
for p in bash sh dash cat ls env head tail sed awk grep cut sort wc ssh scp Xvfb x11vnc websockify xterm xfwm4 xfce4-panel xwd python3; do
  [ -e "$R/usr/bin/$p" ] || [ -e "$R/bin/$p" ] || missing="$missing $p"
done
if [ -n "$missing" ]; then
  echo "REFUSING: the tree is missing$missing"
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
tar -C "$R" -czf "$OUT" .
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
