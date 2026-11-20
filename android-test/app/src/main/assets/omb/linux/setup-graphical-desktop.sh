#!/bin/bash
# Checks that the phone's Linux environment can run the desktop, and says what is missing.
#
# This used to install X11/VNC from pre-downloaded .debs. The archive is now built by
# scripts/build-android-rootfs.sh from a clean Debian bookworm debootstrap, with Xvfb, x11vnc, XFCE,
# xterm, bash, coreutils and openssh-client already in it, so there is nothing to unpack here. What
# remains is the check: a missing program must fail loudly at start, not surface later as a desktop
# that will not open or a VPS that cannot connect.
#
# Run inside proot: /host-linux/setup-graphical-desktop.sh
set -e

# A bare shell inside proot has no default path, and every program below is called by name.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export TMPDIR="/tmp"

echo "=== Checking the phone's Linux environment ==="

missing=""
for p in bash sh dash cat ls env ssh scp Xvfb x11vnc websockify xterm; do
  command -v "$p" >/dev/null 2>&1 || missing="$missing $p"
done
if [ -n "$missing" ]; then
  echo "MISSING:$missing"
  echo "The Linux archive was built without these; rebuild it with scripts/build-android-rootfs.sh."
  exit 1
fi
echo "  every program the desktop and the VPS need is present"

# The app's uid needs a name here: ssh refuses to run otherwise, which is exactly how the VPS
# destination failed before.
if ! grep -q "^android:" /etc/passwd 2>/dev/null; then
  printf 'android:x:%s:%s:Android:/root:/bin/bash\n' "$(id -u)" "$(id -u)" >> /etc/passwd
  echo "  added the app's uid to the guest passwd"
fi

# Directories the launcher and the harness write into; /tmp is the host's linux/tmp under proot.
mkdir -p /tmp /work /root
chmod 1777 /tmp

echo "=== Ready ==="
: > /host-linux/tmp/setup-done 2>/dev/null || true
