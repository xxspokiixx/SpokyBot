#!/bin/bash
# Installs one set of packages into the already-built rootfs. Kept as a file beside the rootfs so it
# runs inside the chroot with no quoting to survive: the phone build and a correction both use it.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends novnc websockify
echo "websockify: $(command -v websockify || echo MISSING)"
echo "novnc: $(ls -d /usr/share/novnc 2>/dev/null || echo MISSING)"
