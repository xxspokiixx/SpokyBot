#!/bin/bash
# Lists each program the phone's two destinations depend on, with the type tar recorded for it. A `l`
# (symlink) in the first column is what the old archive had where a `-` (regular file) belongs.
set -euo pipefail
ARCHIVE=${1:-/mnt/c/Users/xxspokiixx/Documents/GitHub/SpokyBot/android-test/runtime/android-arm64/linux/rootfs.tar.gz}
tar -tzvf "$ARCHIVE" > /tmp/rootfs-listing.txt 2>/dev/null || tar -tzvf "$ARCHIVE" > /tmp/rootfs-listing.txt
for p in ./bin/bash ./bin/sh ./bin/dash ./usr/bin/bash ./usr/bin/cat ./usr/bin/ls ./usr/bin/env \
         ./usr/bin/ssh ./usr/bin/scp ./usr/bin/xterm ./usr/bin/Xvfb ./usr/bin/x11vnc \
         ./usr/lib/ld-linux-aarch64.so.1 ./lib/ld-linux-aarch64.so.1 ./usr/bin/dpkg-deb; do
  line=$(grep -F " $p" /tmp/rootfs-listing.txt | head -1 || true)
  if [ -z "$line" ]; then
    printf '%-34s ABSENT\n' "$p"
  else
    printf '%-34s %s\n' "$p" "$(echo "$line" | awk '{print $1, $3}')"
  fi
done
echo "=== archive size ==="
du -h "$ARCHIVE"
