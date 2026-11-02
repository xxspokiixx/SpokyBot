# Offline Rootfs Build

Builds a Debian-based rootfs tarball with Xvfb, x11vnc, openbox, and noVNC for container-less Local VM deployment.

## Prerequisites

- WSL2 Ubuntu (or native Linux)
- Root access (sudo)
- `debootstrap` package: `sudo apt-get install debootstrap`

## Usage

```bash
# In WSL Ubuntu terminal (as root)
sudo python3 scripts/build-offline-rootfs.py

# Or via pnpm (also requires root)
sudo pnpm build:offline-rootfs
```

## Output

- `dist/offline-rootfs/rootfs.tar.gz` — The rootfs tarball (~500-800 MB)
- `dist/offline-rootfs/metadata.json` — Build metadata (size, sha256, package list)

## What's Included

### Core X11/VNC Stack
- **Xvfb** — Virtual framebuffer X server (display :1)
- **x11vnc** — VNC server sharing the Xvfb display (port 5900)
- **openbox** — Lightweight window manager
- **noVNC + websockify** — Web-based VNC client (port 6080)

### Browsers
- **Chromium** — With headless wrapper (`chromium-headless`)
- **Firefox ESR** — With headless wrapper (`firefox-headless`)

### Base System
- Debian 12 (bookworm), amd64
- bash, coreutils, python3, git, curl, wget
- fonts-liberation, fonts-dejavu-core, fontconfig
- sudo, dbus-x11, xdg-utils

### Optional Desktop Extras
- pcmanfm (file manager)
- lxterminal (terminal)
- leafpad (text editor)
- galculator (calculator)

## Startup Script

The rootfs includes `/usr/local/bin/start-xvfb` which starts:
1. Xvfb on `:1` (1920x1080x24)
2. openbox window manager
3. x11vnc on port 5900
4. noVNC/websockify on port 6080

Access the desktop via browser at `http://<host>:6080/vnc.html`

## Android/WSL Compatibility Fixes

The build applies the same fixes as the Android rootfs:
1. **Absolute symlinks → relative** (toybox tar compatibility)
2. **Hard links → symlinks** (Android link(2) restriction)
3. **Compat symlinks** — `/bin/bash`, `/bin/sh`, `/lib/ld-linux-x86-64.so.2`, etc.

## Integration

The rootfs tarball can be used by container-computer logic for a Docker-less Local VM:

```bash
# Extract
tar -xzf rootfs.tar.gz -C /path/to/vm-rootfs

# Run with proot (like Android)
proot -R /path/to/vm-rootfs -b /host/workspace:/work -w /work /bin/bash -lc 'start-xvfb'
```

## Customization

Edit `scripts/build-offline-rootfs.py` to:
- Change `DEBIAN_RELEASE` (bookworm, trixie, sid)
- Modify `PACKAGES` / `OPTIONAL_PACKAGES` lists
- Adjust Xvfb resolution in `start-xvfb` script
- Add custom configuration files