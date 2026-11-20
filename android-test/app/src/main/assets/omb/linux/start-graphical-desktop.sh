#!/bin/bash
# The phone's own desktop: Xvfb, XFCE, x11vnc and noVNC, on the display and port the harness expects
# (:1 and 56082). The guest is built by scripts/build-android-rootfs.sh, where every program below is a
# real file.
#
# Why it looks like this:
#   - each piece is proven before the next starts, so a failure names itself;
#   - every long-lived process is started with `setsid`, so it survives this script's own process group
#     being torn down (proot kills the group when its child exits);
#   - `-noshm` on x11vnc: proot cannot provide System V shared memory and x11vnc exits at once with
#     "shmget: Function not implemented" without it.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LD_LIBRARY_PATH=/usr/lib/aarch64-linux-gnu:/lib/aarch64-linux-gnu:/usr/lib:/lib
export TMPDIR=/tmp
export HOME=/root
DISPLAY_NUM=${DISPLAY_NUM:-1}
export DISPLAY=":${DISPLAY_NUM}"
WIDTH=${1:-1600}
HEIGHT=${2:-1000}
DEPTH=${3:-24}
VIEWER_PORT=${VIEWER_PORT:-56082}

log() { echo "[desktop] $*"; }

daemon() { setsid "$@" >/dev/null 2>&1 < /dev/null & echo $!; }

pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null
pkill -f "x11vnc.*:${DISPLAY_NUM}" 2>/dev/null
pkill -f "websockify.*${VIEWER_PORT}" 2>/dev/null
pkill -f "xfwm4" 2>/dev/null
pkill -f "xfce4-panel" 2>/dev/null
pkill -f "xterm" 2>/dev/null
sleep 1
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" /tmp/desktop-ready 2>/dev/null

# Xvfb, proven by asking it: xdpyinfo answers only from a display that is really up.
XVFB_PID=$(daemon Xvfb ":${DISPLAY_NUM}" -screen 0 "${WIDTH}x${HEIGHT}x${DEPTH}" -ac +extension GLX +extension RANDR -nolock)
for _ in $(seq 1 60); do
  xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1 && break
  sleep 0.5
done
if ! xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1; then
  log "Xvfb did not answer on :${DISPLAY_NUM}"
  exit 1
fi
log "Xvfb up on :${DISPLAY_NUM} ${WIDTH}x${HEIGHT} (PID $XVFB_PID)"

# x11vnc before the window manager: it is the piece the person actually sees, and it must not depend on
# anything XFCE does.
X11VNC_PID=$(daemon x11vnc -display ":${DISPLAY_NUM}" -forever -shared -rfbport 5900 -nopw -noshm -noxdamage -noxfixes -nowf -noscr)
for _ in $(seq 1 20); do
  kill -0 "$X11VNC_PID" 2>/dev/null && break
  sleep 0.5
done
if ! kill -0 "$X11VNC_PID" 2>/dev/null; then
  log "x11vnc exited; the framebuffer cannot be read"
  exit 1
fi
log "x11vnc on 5900 (PID $X11VNC_PID)"

# noVNC: the page a person opens. Bound to loopback: a bare port would publish an unauthenticated
# desktop to whatever network the phone is on.
WEBSOCKIFY_PID=$(daemon websockify --web=/usr/share/novnc "127.0.0.1:${VIEWER_PORT}" 127.0.0.1:5900)
sleep 3
if ! kill -0 "$WEBSOCKIFY_PID" 2>/dev/null; then
  log "websockify exited; the viewer cannot open"
  exit 1
fi
log "noVNC on http://127.0.0.1:${VIEWER_PORT}/vnc.html (PID $WEBSOCKIFY_PID)"

# XFCE last: it is what makes the desktop legible, and its parts may come and go without taking the
# display or the viewer down.
dbus-daemon --session --fork --print-address > /tmp/dbus-address 2>/dev/null || log "no dbus session"
[ -s /tmp/dbus-address ] && export DBUS_SESSION_BUS_ADDRESS="$(cat /tmp/dbus-address)"
daemon xfwm4 --compositor=off > /dev/null
sleep 2
daemon xfce4-panel > /dev/null
daemon xterm -geometry 100x28 -fa Monospace -fs 11 -e /bin/bash > /dev/null
log "XFCE launched"

# The marker the harness waits for: two pids, proven alive. Written only once there is a desktop to see.
printf '%s %s\n' "$XVFB_PID" "$X11VNC_PID" > /tmp/desktop-ready
log "ready"

# Stay while the pieces that matter are alive, so the harness sees the desktop's own lifetime.
while kill -0 "$XVFB_PID" 2>/dev/null && kill -0 "$X11VNC_PID" 2>/dev/null && kill -0 "$WEBSOCKIFY_PID" 2>/dev/null; do
  sleep 5
done
log "a required piece exited"
