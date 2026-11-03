#!/usr/bin/env python3
"""
Offline rootfs builder for Linux desktop (amd64).

Builds a Debian-based rootfs with Xvfb, x11vnc, openbox, and noVNC
using debootstrap in WSL. Outputs a rootfs.tar.gz suitable for
container-less Local VM deployment.

Usage (in WSL Ubuntu):
    sudo python3 scripts/build-offline-rootfs.py

Output:
    dist/offline-rootfs/rootfs.tar.gz
"""

import os
import sys
import subprocess
import shutil
import tarfile
import hashlib
import json
from pathlib import Path

# Configuration
DEBIAN_RELEASE = "bookworm"
DEBIAN_MIRROR = "http://deb.debian.org/debian"
ARCH = "amd64"
WORK_DIR = Path.home() / "offline-rootfs-build"
ROOTFS_DIR = WORK_DIR / "rootfs"
OUTPUT_DIR = Path(__file__).parent.parent / "dist" / "offline-rootfs"
OUTPUT_TARBALL = OUTPUT_DIR / "rootfs.tar.gz"

# Packages to install in the rootfs
PACKAGES = [
    # X11 / VNC
    "xvfb",
    "x11vnc",
    "openbox",
    "novnc",
    "websockify",
    "tigervnc-standalone-server",
    "xauth",
    "x11-xserver-utils",
    # Window manager utilities
    "obconf",
    "lxappearance",
    # Browser
    "chromium",
    "firefox-esr",
    # Basic tools
    "bash",
    "coreutils",
    "python3",
    "python3-pip",
    "git",
    "curl",
    "wget",
    "ca-certificates",
    "fonts-liberation",
    "fonts-dejavu-core",
    "fontconfig",
    # Process management
    "procps",
    "htop",
    # Network
    "net-tools",
    "iproute2",
    "dnsutils",
    # Archive
    "tar",
    "gzip",
    "xz-utils",
    # Misc
    "sudo",
    "dbus-x11",
    "xdg-utils",
]

# Additional packages for a more complete desktop
OPTIONAL_PACKAGES = [
    "pcmanfm",
    "lxterminal",
    "mousepad",
    "galculator",
]


def run_cmd(cmd, cwd=None, check=True, capture=False, env=None):
    """Run a command and return the result."""
    print(f"$ {cmd}")
    result = subprocess.run(
        cmd,
        shell=True,
        cwd=cwd,
        check=check,
        capture_output=capture,
        text=True,
        env=env or os.environ,
    )
    if capture:
        return result.stdout.strip()
    return result


def run_cmd_stream(cmd, cwd=None, env=None):
    """Run a command with streaming output."""
    print(f"$ {cmd}")
    proc = subprocess.Popen(
        cmd,
        shell=True,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env or os.environ,
    )
    for line in proc.stdout:
        print(line.rstrip())
    proc.wait()
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd)
    return proc


def setup_work_dir():
    """Create and clean work directory."""
    if WORK_DIR.exists():
        print(f"Cleaning existing work dir: {WORK_DIR}")
        shutil.rmtree(WORK_DIR, ignore_errors=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    ROOTFS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def debootstrap_rootfs():
    """Run debootstrap to create minimal rootfs."""
    print(f"\n=== Debootstrapping {DEBIAN_RELEASE} ({ARCH}) ===")
    cmd = [
        "debootstrap",
        f"--arch={ARCH}",
        f"--variant=minbase",
        DEBIAN_RELEASE,
        str(ROOTFS_DIR),
        DEBIAN_MIRROR,
    ]
    run_cmd(" ".join(cmd), check=True)


def configure_apt():
    """Configure apt sources in the rootfs."""
    print("\n=== Configuring APT ===")
    sources_list = ROOTFS_DIR / "etc" / "apt" / "sources.list"
    sources_list.write_text(f"""deb {DEBIAN_MIRROR} {DEBIAN_RELEASE} main contrib non-free non-free-firmware
deb {DEBIAN_MIRROR} {DEBIAN_RELEASE}-updates main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security {DEBIAN_RELEASE}-security main contrib non-free non-free-firmware
""")


def chroot_install(packages):
    """Install packages inside the rootfs using chroot."""
    print(f"\n=== Installing packages: {' '.join(packages)} ===")

    # Update package list
    run_cmd_stream(f"chroot {ROOTFS_DIR} apt-get update")

    # Install packages
    pkg_list = " ".join(packages)
    run_cmd_stream(f"chroot {ROOTFS_DIR} apt-get install -y --no-install-recommends {pkg_list}")

    # Clean up
    run_cmd_stream(f"chroot {ROOTFS_DIR} apt-get clean")
    run_cmd_stream(f"chroot {ROOTFS_DIR} rm -rf /var/lib/apt/lists/*")


def setup_xvfb_service():
    """Create Xvfb startup script."""
    print("\n=== Setting up Xvfb service ===")
    script = ROOTFS_DIR / "usr" / "local" / "bin" / "start-xvfb"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text("""#!/bin/bash
# Start Xvfb on display :1
export DISPLAY=:1
Xvfb :1 -screen 0 1920x1080x24 -ac +extension GLX +extension RANDR &
XVFB_PID=$!

# Wait for Xvfb to be ready
for i in {1..30}; do
    if xdpyinfo -display :1 >/dev/null 2>&1; then
        break
    fi
    sleep 0.1
done

# Start openbox
openbox --display :1 &
OPENBOX_PID=$!

# Start x11vnc
x11vnc -display :1 -forever -shared -rfbport 5900 -rfbportv6 5900 -nopw -quiet &
X11VNC_PID=$!

# Start noVNC (websockify)
websockify --web /usr/share/novnc/ 6080 localhost:5900 &
WEBSOCKIFY_PID=$!

echo "Xvfb started on :1 (PID: $XVFB_PID)"
echo "openbox started (PID: $OPENBOX_PID)"
echo "x11vnc started on port 5900 (PID: $X11VNC_PID)"
echo "noVNC started on port 6080 (PID: $WEBSOCKIFY_PID)"

# Wait for any process to exit
wait -n
""")
    script.chmod(0o755)


def setup_chromium_wrapper():
    """Create Chromium wrapper for headless use."""
    print("\n=== Setting up Chromium wrapper ===")
    script = ROOTFS_DIR / "usr" / "local" / "bin" / "chromium-headless"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text("""#!/bin/bash
# Chromium headless wrapper for noVNC environment
export DISPLAY=:1
export CHROMIUM_FLAGS="--no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9222"
exec chromium $CHROMIUM_FLAGS "$@"
""")
    script.chmod(0o755)


def setup_firefox_wrapper():
    """Create Firefox wrapper for headless use."""
    print("\n=== Setting up Firefox wrapper ===")
    script = ROOTFS_DIR / "usr" / "local" / "bin" / "firefox-headless"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text("""#!/bin/bash
# Firefox headless wrapper
export DISPLAY=:1
export MOZ_HEADLESS=1
exec firefox-esr --headless "$@"
""")
    script.chmod(0o755)


def fix_symlinks():
    """Fix absolute symlinks to relative (for tar compatibility)."""
    print("\n=== Fixing absolute symlinks ===")
    fixed = 0
    for root, dirs, files in os.walk(ROOTFS_DIR):
        for name in files + dirs:
            path = Path(root) / name
            if path.is_symlink():
                target = os.readlink(path)
                if target.startswith("/"):
                    # Convert to relative
                    rel_root = Path(root).relative_to(ROOTFS_DIR)
                    depth = len(rel_root.parts) if str(rel_root) != "." else 0
                    prefix = "../" * depth
                    new_target = prefix + target.lstrip("/")
                    os.unlink(path)
                    path.symlink_to(new_target)
                    fixed += 1
    print(f"Fixed {fixed} absolute symlinks")


def fix_hardlinks():
    """Convert hard links to symlinks (Android/WSL compatibility)."""
    print("\n=== Fixing hard links ===")
    # Find files with link count > 1
    inode_map = {}
    for root, dirs, files in os.walk(ROOTFS_DIR):
        for name in files:
            path = Path(root) / name
            try:
                stat = path.stat()
                if stat.st_nlink > 1:
                    key = (stat.st_dev, stat.st_ino)
                    if key not in inode_map:
                        inode_map[key] = path
                    else:
                        # Replace with symlink to first file
                        original = inode_map[key]
                        rel_original = original.relative_to(path.parent)
                        os.unlink(path)
                        path.symlink_to(rel_original)
            except OSError:
                pass
    print(f"Processed {len(inode_map)} inode groups")


def add_compat_symlinks():
    """Add /bin and /lib compatibility symlinks."""
    print("\n=== Adding compat symlinks ===")
    compat_links = [
        ("/bin/bash", "/usr/bin/bash"),
        ("/bin/sh", "/usr/bin/sh"),
        ("/bin/env", "/usr/bin/env"),
        ("/bin/ls", "/usr/bin/ls"),
        ("/bin/cat", "/usr/bin/cat"),
        ("/lib/ld-linux-x86-64.so.2", "/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"),
        ("/lib64/ld-linux-x86-64.so.2", "/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"),
    ]
    for link_path, target in compat_links:
        full_link = ROOTFS_DIR / link_path.lstrip("/")
        full_link.parent.mkdir(parents=True, exist_ok=True)
        if not full_link.exists():
            full_link.symlink_to(target)
            print(f"  Created {link_path} -> {target}")


def create_tarball():
    """Create the rootfs.tar.gz tarball."""
    print(f"\n=== Creating tarball: {OUTPUT_TARBALL} ===")
    with tarfile.open(OUTPUT_TARBALL, "w:gz") as tar:
        tar.add(ROOTFS_DIR, arcname=".", filter=lambda x: x)

    size = OUTPUT_TARBALL.stat().st_size
    sha256 = hashlib.sha256()
    with open(OUTPUT_TARBALL, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)

    print(f"Size: {size:,} bytes ({size / 1024 / 1024:.1f} MB)")
    print(f"SHA256: {sha256.hexdigest()}")

    # Write metadata
    meta = {
        "debian_release": DEBIAN_RELEASE,
        "arch": ARCH,
        "size": size,
        "sha256": sha256.hexdigest(),
        "packages": PACKAGES + OPTIONAL_PACKAGES,
    }
    meta_file = OUTPUT_DIR / "metadata.json"
    meta_file.write_text(json.dumps(meta, indent=2))
    print(f"Metadata written to {meta_file}")


def main():
    print("=== Offline Rootfs Builder ===")
    print(f"Work dir: {WORK_DIR}")
    print(f"Output: {OUTPUT_TARBALL}")
    print(f"Debian: {DEBIAN_RELEASE} ({ARCH})")

    # Check for root (debootstrap needs it)
    if os.geteuid() != 0:
        print("ERROR: This script must run as root (sudo)")
        sys.exit(1)

    # Check for debootstrap
    if not shutil.which("debootstrap"):
        print("ERROR: debootstrap not found. Install with: apt-get install debootstrap")
        sys.exit(1)

    try:
        setup_work_dir()
        debootstrap_rootfs()
        configure_apt()
        chroot_install(PACKAGES + OPTIONAL_PACKAGES)
        setup_xvfb_service()
        setup_chromium_wrapper()
        setup_firefox_wrapper()
        fix_symlinks()
        fix_hardlinks()
        add_compat_symlinks()
        create_tarball()

        print("\n=== Build Complete ===")
        print(f"Rootfs tarball: {OUTPUT_TARBALL}")
        print(f"Metadata: {OUTPUT_DIR / 'metadata.json'}")

    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()