const fs = require("fs");
/* eslint-disable no-useless-escape */
const script = `#!/bin/bash
# Start the graphical desktop (Xvfb + openbox + x11vnc + noVNC)
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

WIDTH=\${1:-1920}
HEIGHT=\${2:-1080}
DEPTH=\${3:-24}

# Kill any existing instances
pkill -f "Xvfb :1" 2>/dev/null || true
pkill -f "x11vnc.*:1" 2>/dev/null || true
pkill -f "websockify.*6080" 2>/dev/null || true
sleep 1

# Start Xvfb (virtual framebuffer)
Xvfb :1 -screen 0 \${WIDTH}x\${HEIGHT}x\${DEPTH} &
XVFB_PID=\$!
echo "XVFB_PID=\$XVFB_PID"
sleep 2

# Start openbox (window manager)
DISPLAY=:1 openbox &
OPENBOX_PID=\$!
echo "OPENBOX_PID=\$OPENBOX_PID"
sleep 1

# Start x11vnc (VNC server)
x11vnc -display :1 -forever -shared -rfbport 5900 -nopw &
X11VNC_PID=\$!
echo "X11VNC_PID=\$X11VNC_PID"
sleep 1

# Start noVNC (web-based VNC client)
websockify --web=/usr/share/novnc 6080 localhost:5900 &
NOVNC_PID=\$!
echo "NOVNC_PID=\$NOVNC_PID"

echo ""
echo "=== Graphical desktop started ==="
echo "noVNC URL: http://localhost:6080/vnc.html"
echo "VNC port: 5900"
echo "Display: :1 (\${WIDTH}x\${HEIGHT}x\${DEPTH})"
echo ""
echo "To stop: pkill -f 'Xvfb :1'; pkill -f x11vnc; pkill -f websockify"

# Keep running
wait
`;
/* eslint-enable no-useless-escape */
fs.mkdirSync("/data/user/0/com.openmausbot.test/files/linux/rootfs/usr/local/bin", { recursive: true });
fs.writeFileSync("/data/user/0/com.openmausbot.test/files/linux/rootfs/usr/local/bin/start-graphical-desktop", script);
fs.chmodSync("/data/user/0/com.openmausbot.test/files/linux/rootfs/usr/local/bin/start-graphical-desktop", 0o755);
console.log("Written");