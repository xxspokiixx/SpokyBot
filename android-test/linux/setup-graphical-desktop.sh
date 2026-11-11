#!/bin/bash
# Setup script for graphical desktop in the Android proot environment.
# Run this inside the proot environment: /host-linux/setup-graphical-desktop.sh
# This installs Xvfb, openbox, x11vnc, and noVNC for a graphical desktop experience.
# Uses pre-downloaded .deb packages from /host-linux/debs (no network required).

set -e

echo "=== Setting up graphical desktop for Android local computer ==="
echo "Using pre-downloaded X11/VNC packages from /host-linux/debs"
echo ""

# Use host-linux/tmp for apt temporary files (writable in proot)
export TMPDIR="/host-linux/tmp"
mkdir -p "$TMPDIR"

# Create a temporary directory for debs
DEB_DIR="/host-linux/tmp/graphical-desktop-debs"
mkdir -p "$DEB_DIR"
cd "$DEB_DIR"

# Copy pre-downloaded debs from /host-linux/debs
echo "Copying pre-downloaded packages..."
if [ -d "/host-linux/debs" ]; then
    cp /host-linux/debs/*.deb "$DEB_DIR/" 2>/dev/null || true
    echo "  Copied $(ls *.deb 2>/dev/null | wc -l) packages"
else
    echo "  WARNING: /host-linux/debs not found, packages may be missing"
fi

# Show what we have
echo "Available packages:"
ls -la *.deb 2>/dev/null | head -30 || echo "  (no .deb files found)"

# Extract all debs to rootfs
echo "Extracting packages to rootfs..."
for deb in *.deb; do
    if [ -f "$deb" ]; then
        echo "  Extracting $deb..."
        dpkg-deb -x "$deb" / 2>&1 | tail -3
    fi
done

# Clean up
cd /
rm -rf "$DEB_DIR"

# Create the start script
cat > /usr/local/bin/start-graphical-desktop << 'STARTSCRIPT'
#!/bin/bash
# Start the graphical desktop (Xvfb + openbox + x11vnc + noVNC)
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export LD_LIBRARY_PATH="/usr/lib/aarch64-linux-gnu:/lib/aarch64-linux-gnu:/usr/lib:/lib"

# Use /tmp for Xvfb lock files (bind mounted from host-linux/tmp)
export TMPDIR="/tmp"
mkdir -p "$TMPDIR"

WIDTH=${1:-1920}
HEIGHT=${2:-1080}
DEPTH=${3:-24}

# Kill any existing instances
pkill -f "Xvfb :3" 2>/dev/null || true
pkill -f "x11vnc.*:3" 2>/dev/null || true
pkill -f "websockify.*56082" 2>/dev/null || true
sleep 1

# Remove stale Xvfb lock file
rm -f /tmp/.X3-lock 2>/dev/null || true

# Start Xvfb (virtual framebuffer) with -nolock flag (requires fake root via proot -0)
Xvfb :3 -screen 0 ${WIDTH}x${HEIGHT}x${DEPTH} -nolock &
XVFB_PID=$!
echo "XVFB_PID=$XVFB_PID"
sleep 3

# Verify Xvfb is running
if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "ERROR: Xvfb failed to start"
    exit 1
fi

# Start openbox (window manager)
DISPLAY=:3 openbox &
OPENBOX_PID=$!
echo "OPENBOX_PID=$OPENBOX_PID"
sleep 1

# Start x11vnc (VNC server)
x11vnc -display :3 -forever -shared -rfbport 5900 -nopw -noxdamage -noxfixes -noxkb -nowf &
X11VNC_PID=$!
echo "X11VNC_PID=$X11VNC_PID"
sleep 1

# Start noVNC (web-based VNC client)
websockify --web=/usr/share/novnc 56082 localhost:5900 &
NOVNC_PID=$!
echo "NOVNC_PID=$NOVNC_PID"

echo ""
echo "=== Graphical desktop started ==="
echo "noVNC URL: http://localhost:56082/vnc.html"
echo "VNC port: 5900"
echo "Display: :3 (${WIDTH}x${HEIGHT}x${DEPTH})"
echo ""
echo "To stop: pkill -f 'Xvfb :3'; pkill -f x11vnc; pkill -f 'websockify.*56082'"

# Keep running
wait
STARTSCRIPT

chmod +x /usr/local/bin/start-graphical-desktop

echo ""
echo "=== Graphical desktop setup complete ==="
echo "To start the desktop, run: start-graphical-desktop"
echo "Or use the 'start_graphical_desktop' tool from the bot."
echo ""
echo "noVNC will be available at: http://localhost:56082/vnc.html"