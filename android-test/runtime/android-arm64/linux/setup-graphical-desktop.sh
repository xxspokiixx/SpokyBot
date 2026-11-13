#!/bin/bash
# Setup script for graphical desktop in the Android proot environment.
# Run this inside the proot environment: /host-linux/setup-graphical-desktop.sh
# Installs an XFCE desktop (Xvfb + xfwm4 + picom + xfce4-panel) with x11vnc and noVNC.
# Uses pre-downloaded .deb packages from /host-linux/debs (no network required for X11 itself);
# the XFCE stack comes from apt when the network answers, and jwm stays the fallback.

set -e

echo "=== Setting up graphical desktop for Android local computer ==="
echo "Using pre-downloaded X11/VNC packages from /host-linux/debs"
echo ""

# Use host-linux/tmp for apt temporary files (writable in proot)
export TMPDIR="/host-linux/tmp"
mkdir -p "$TMPDIR"

export DEBIAN_FRONTEND=noninteractive
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HOME=/root

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

# XFCE needs the icon themes that actually own the launcher art, and fontconfig: a GTK app
# with no font and no icon theme renders every plugin as the generic gear placeholder.
XFCE_PACKAGES="xfce4-panel xfwm4 picom xfce4-terminal thunar xdotool feh fontconfig fonts-dejavu-core adwaita-icon-theme hicolor-icon-theme gnome-icon-theme"
echo "Installing XFCE stack..."
apt-get update -qq >/dev/null 2>&1 || true
for pkg in $XFCE_PACKAGES; do
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$pkg" >/dev/null 2>&1 \
        && echo "  $pkg: installed" || echo "  $pkg: MISSING (no network?)"
done

# jwm stays the fallback when the XFCE packages could not be installed.
if ! command -v xfce4-panel >/dev/null 2>&1; then
    echo "XFCE unavailable, falling back to jwm..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends jwm xterm mc libutempter0 >/dev/null 2>&1 || true
fi

# Chromium is the browser; it is a separate install because it is large.
command -v chromium >/dev/null 2>&1 || \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends chromium >/dev/null 2>&1 && \
    echo "Chromium: installed" || echo "Chromium: MISSING (no network?)"

WM="xfce"
command -v xfce4-panel >/dev/null 2>&1 || WM="jwm"
command -v jwm >/dev/null 2>&1 || WM="openbox"
echo "Window manager: $WM"

# The terminal launcher. XFCE's launcher plugin resolves icons through garcon, which only
# pools .desktop files that declare Categories, so the file must carry them.
cat > /usr/local/share/applications/omb-terminal.desktop << 'TERMINAL_DESKTOP'
[Desktop Entry]
Version=1.0
Type=Application
Name=Terminal
Comment=Open a terminal in the desktop
Exec=xfce4-terminal
Icon=utilities-terminal
Terminal=false
Categories=Utility;TerminalEmulator;
StartupNotify=true
TERMINAL_DESKTOP
update-desktop-database /usr/local/share/applications 2>/dev/null || true

# The icon theme. gnome owns utilities-terminal and inherits hicolor, which owns chromium and
# org.xfce.thunar; Adwaita owns none of them, so declaring it turns every launcher into a gear.
mkdir -p /etc/gtk-3.0 /root/.config/gtk-3.0
cat > /etc/gtk-3.0/settings.ini << 'GTKSETTINGS'
[Settings]
gtk-theme-name=Adwaita-dark
gtk-icon-theme-name=gnome
gtk-font-name=Sans 10
gtk-application-prefer-dark-theme=1
GTKSETTINGS
cp /etc/gtk-3.0/settings.ini /root/.config/gtk-3.0/settings.ini

# The panel channel. It must be written while no xfce4-panel and no xfconfd is alive: the panel
# rewrites the channel on start, so a hand-edited file written afterwards is lost. mode=2 is a
# deskbar, which spans the full width; alignment=1 centres the plugins and the expanding
# separator pushes the clock to the right.
mkdir -p /root/.config/xfce4/xfconf/xfce-perchannel-xml
cat > /root/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml << 'PANELXML'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-panel" version="1.0">
  <property name="panels" type="empty">
    <property name="panel-1" type="empty">
      <property name="position" type="string" value="p=8;x=0;y=0"/>
      <property name="mode" type="int" value="2"/>
      <property name="alignment" type="int" value="1"/>
      <property name="length" type="uint" value="100"/>
      <property name="length-adjust" type="bool" value="true"/>
      <property name="position-locked" type="bool" value="true"/>
      <property name="background-style" type="int" value="0"/>
      <property name="size" type="uint" value="28"/>
      <property name="plugin-ids" type="array">
        <value type="int" value="1"/>
        <value type="int" value="2"/>
        <value type="int" value="3"/>
        <value type="int" value="4"/>
        <value type="int" value="5"/>
      </property>
    </property>
  </property>
  <property name="plugins" type="empty">
    <property name="plugin-1" type="empty">
      <property name="name" type="string" value="launcher"/>
      <property name="items" type="array">
        <value type="string" value="chromium.desktop"/>
      </property>
    </property>
    <property name="plugin-2" type="empty">
      <property name="name" type="string" value="launcher"/>
      <property name="items" type="array">
        <value type="string" value="omb-terminal.desktop"/>
      </property>
    </property>
    <property name="plugin-3" type="empty">
      <property name="name" type="string" value="launcher"/>
      <property name="items" type="array">
        <value type="string" value="thunar.desktop"/>
      </property>
    </property>
    <property name="plugin-4" type="empty">
      <property name="name" type="string" value="separator"/>
      <property name="expand" type="bool" value="true"/>
    </property>
    <property name="plugin-5" type="empty">
      <property name="name" type="string" value="clock"/>
      <property name="mode" type="uint" value="2"/>
      <property name="digital-format" type="string" value="%H:%M"/>
    </property>
  </property>
</channel>
PANELXML

# Launcher icons for the jwm fallback. XPM is jwm's native format, so the tray never depends on
# an image library; the folder one is drawn here.
ICONS=/usr/local/share/omb-icons
mkdir -p "$ICONS"

cat > "$ICONS/terminal.xpm" << 'TERMINAL_ICON'
/* XPM */
static char *terminal_xpm[] = {
"24 22 2 1",
". c None",
"+ c #39D353",
"........................",
"........................",
"........................",
"....+...................",
".....+..................",
"......+.................",
".......+................",
"......+.................",
".....+..................",
"....+...................",
"........................",
"...+++++++++++..........",
"........................",
"........................",
"........................",
"........................",
"........................",
"........................",
"........................",
"........................",
"........................",
"........................"
};
TERMINAL_ICON

cat > "$ICONS/browser.xpm" << 'BROWSER_ICON'
/* XPM */
static char *browser_xpm[] = {
"24 22 2 1",
". c None",
"+ c #4A90D9",
"..++++++++++++++++++++..",
"..++++++++++++++++++++..",
"..++++++++++++++++++++..",
"..++++++++++++++++++++..",
"..++++++++++++++++++++..",
"..++++++++++++++++++++..",
"..++++++++++++++++++++..",
"...++++++++++++++++++...",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"....++++++++++++++++....",
"...++++++++++++++++++..."
};
BROWSER_ICON

cat > "$ICONS/folder.xpm" << 'FOLDER_ICON'
/* XPM */
static char *folder_xpm[] = {
"24 22 2 1",
". c None",
"+ c #E3B341",
"........................",
"........................",
"........................",
".......+++++++.........",
".......+++++++.........",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++",
".......+++++++++++++++++"
};
FOLDER_ICON

# jwm's own config: a bottom tray with the three launchers, and a root menu whose entries
# actually run. The distribution default menu points at xlock/systemctl, which do not exist
# here, which is why its entries do nothing.
cat > /root/.jwmrc << 'JWMRC'
<?xml version="1.0"?>
<JWM>
    <Desktops width="4" height="1"/>

    <Tray x="0" y="-1" height="30" autohide="off" delay="1000">
        <TrayButton label="Browser" icon="/usr/local/share/omb-icons/browser.xpm" tip="Browser">exec:chromium --no-sandbox --disable-dev-shm-usage</TrayButton>
        <TrayButton label="Terminal" icon="/usr/local/share/omb-icons/terminal.xpm" tip="Terminal">exec:xterm</TrayButton>
        <TrayButton label="Files" icon="/usr/local/share/omb-icons/folder.xpm" tip="Files">exec:xterm -e mc /work</TrayButton>
        <Spacer width="6"/>
        <Pager labeled="true"/>
        <TaskList maxwidth="256"/>
        <Clock format="%H:%M"/>
    </Tray>

    <RootMenu>
        <Program label="Browser" icon="/usr/local/share/omb-icons/browser.xpm">chromium --no-sandbox --disable-dev-shm-usage</Program>
        <Program label="Terminal" icon="/usr/local/share/omb-icons/terminal.xpm">exec:xterm</Program>
        <Program label="Files" icon="/usr/local/share/omb-icons/folder.xpm">exec:xterm -e mc /work</Program>
        <Separator/>
        <Restart/>
        <Exit/>
    </RootMenu>

    <WindowStyle decorations="flat">
        <Font>Sans-12</Font>
        <Width>2</Width>
        <Height>20</Height>
        <Foreground>#FFFFFF</Foreground>
        <Background>#2B3444</Background>
        <Active>
            <Foreground>#FFFFFF</Foreground>
            <Background>#4A90D9</Background>
        </Active>
    </WindowStyle>
    <TrayStyle decorations="flat">
        <Font>Sans-12</Font>
        <Background>#1E2430</Background>
        <Foreground>#D7E3F0</Foreground>
    </TrayStyle>
    <TaskListStyle list="all">
        <Font>Sans-12</Font>
        <Background>#1E2430</Background>
        <Foreground>#D7E3F0</Foreground>
        <Active>
            <Background>#4A90D9</Background>
            <Foreground>#FFFFFF</Foreground>
        </Active>
    </TaskListStyle>
</JWM>
JWMRC
echo "Launcher icons and jwm config written to $ICONS and /root/.jwmrc"

# The supervisor. One session bus, one X display, one viewer chain:
# novnc (browser) -> websockify -> x11vnc -> XTEST, so every app sees a real mouse and keyboard.
# The XDG_* exports matter: Android's values leak into the guest, and with them GTK looks for
# its icon themes and caches outside the rootfs and renders placeholders.
cat > /usr/local/bin/xfce-supervisor << 'SUPERVISOR'
#!/bin/bash
export TMPDIR=/tmp HOME=/root DISPLAY=:3
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/host-linux"
export XDG_DATA_HOME=/root/.local/share
export XDG_CONFIG_HOME=/root/.config
export XDG_CACHE_HOME=/root/.cache
export XDG_DATA_DIRS=/usr/local/share:/usr/share
export XDG_RUNTIME_DIR=/tmp/runtime
mkdir -p "$TMPDIR" /tmp/runtime
chmod 1777 /tmp 2>/dev/null
chmod 700 /tmp/runtime 2>/dev/null

eval "$(dbus-launch --sh-syntax 2>/dev/null)"
export DBUS_SESSION_BUS_ADDRESS
echo "dbus: $DBUS_SESSION_BUS_ADDRESS"
echo "$DBUS_SESSION_BUS_ADDRESS" > /root/dbus.env

Xvfb :3 -screen 0 1600x1000x24 -nolock >/tmp/xvfb.log 2>&1 &
for _ in $(seq 30); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.2; done

if [ -f /root/fondo.png ]; then feh --bg-fill /root/fondo.png; fi

# The window manager must publish _NET_* before the panel reads it, or the panel starts with
# no work area and drops the struts.
xfwm4 --compositor=off >/tmp/wm.log 2>&1 &
for _ in $(seq 30); do xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null 2>&1 && break; sleep 0.2; done

picom --backend xrender -b >/tmp/picom.log 2>&1

xfce4-panel >/tmp/panel.log 2>&1 &

# -noshm: Android's app sepolicy denies shmget(2), which MIT-SHM needs.
x11vnc -display :3 -forever -shared -rfbport 5900 -nopw -noshm \
  -noxdamage -noxfixes -noxkb -nowf >/tmp/vnc.log 2>&1 &
websockify --web=/usr/share/novnc 56082 localhost:5900 >/tmp/ws.log 2>&1 &

echo "desktop up"
wait
SUPERVISOR
chmod +x /usr/local/bin/xfce-supervisor

# Create the start script
cat > /usr/local/bin/start-graphical-desktop << STARTSCRIPT
#!/bin/bash
# Start the graphical desktop (Xvfb + XFCE + x11vnc + noVNC).
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HOME=/root TMPDIR=/tmp DISPLAY=:3
export XDG_DATA_HOME=/root/.local/share XDG_CONFIG_HOME=/root/.config XDG_CACHE_HOME=/root/.cache
export XDG_DATA_DIRS=/usr/local/share:/usr/share XDG_RUNTIME_DIR=/tmp/runtime
mkdir -p /tmp/runtime "\$TMPDIR"

WIDTH=\${1:-1600}
HEIGHT=\${2:-1000}
DEPTH=\${3:-24}

# Kill any existing instances
pkill -f "Xvfb :3" 2>/dev/null || true
pkill -f "x11vnc.*:3" 2>/dev/null || true
pkill -f "websockify.*56082" 2>/dev/null || true
pkill -f "xfce4-panel" 2>/dev/null || true
pkill -f "xfwm4" 2>/dev/null || true
sleep 1

rm -f /tmp/.X3-lock 2>/dev/null || true

if command -v xfce4-panel >/dev/null 2>&1; then
    exec /usr/local/bin/xfce-supervisor
fi

# jwm fallback when the XFCE packages could not be installed.
Xvfb :3 -screen 0 \${WIDTH}x\${HEIGHT}x\${DEPTH} -nolock &
XVFB_PID=\$!
echo "XVFB_PID=\$XVFB_PID"
sleep 3

if ! kill -0 "\$XVFB_PID" 2>/dev/null; then
    echo "ERROR: Xvfb failed to start"
    exit 1
fi

export DISPLAY=:3
mkdir -p /root
xsetroot -solid "#16324F" 2>/dev/null || true

if command -v jwm >/dev/null 2>&1; then
    jwm -display :3 &
    WM_PID=\$!
    echo "WM_PID=\$WM_PID (jwm)"
else
    openbox -display :3 &
    WM_PID=\$!
    echo "WM_PID=\$WM_PID (openbox)"
fi
sleep 1

x11vnc -display :3 -forever -shared -rfbport 5900 -nopw -noshm -noxdamage -noxfixes -noxkb -nowf &
X11VNC_PID=\$!
echo "X11VNC_PID=\$X11VNC_PID"
sleep 1

websockify --web=/usr/share/novnc 56082 localhost:5900 &
NOVNC_PID=\$!
echo "NOVNC_PID=\$NOVNC_PID"

echo ""
echo "=== Graphical desktop started ==="
echo "noVNC URL: http://localhost:56082/vnc.html"
echo "VNC port: 5900"
echo "Display: :3 (\${WIDTH}x\${HEIGHT})"
echo ""
echo "To stop: pkill -f 'Xvfb :3'; pkill -f x11vnc; pkill -f 'websockify.*56082'"

wait
STARTSCRIPT

chmod +x /usr/local/bin/start-graphical-desktop

echo ""
echo "=== Graphical desktop setup complete ==="
echo "Window manager: $WM"
echo "To start the desktop, run: start-graphical-desktop"
echo "Or use the 'start_graphical_desktop' tool from the bot."
echo ""
echo "noVNC will be available at: http://localhost:56082/vnc.html"
