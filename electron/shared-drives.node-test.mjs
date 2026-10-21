import assert from "node:assert/strict";
import test from "node:test";
import { isShareableDriveRoot, linuxDrive, parseMountInfo, shareableDrive } from "./shared-drives.mjs";

const MOUNTINFO = [
  "25 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw",
  "26 25 259:1 / /boot/efi rw,relatime shared:2 - vfat /dev/nvme0n1p1 rw",
  "27 25 0:23 / /run/user/1000 rw,nosuid shared:3 - tmpfs tmpfs rw",
  "28 25 8:17 / /data rw,relatime shared:4 - ext4 /dev/sdb1 rw",
  "29 25 8:33 / /mnt/backup\\040disk rw,relatime shared:5 - xfs /dev/sdc1 rw",
  "30 25 8:49 / /media/me/USB rw,relatime shared:6 - exfat /dev/sdd1 rw",
  "31 25 8:65 / /var/lib/postgres rw,relatime shared:7 - ext4 /dev/sde1 rw",
  "32 25 0:40 / /srv/overlay rw,relatime shared:8 - overlay overlay rw",
  "garbage line without separator",
].join("\n");

test("parseMountInfo reads mount points and filesystems, unescapes spaces, skips junk", () => {
  const mounts = parseMountInfo(MOUNTINFO);
  assert.equal(mounts.length, 8);
  assert.deepEqual(mounts.find(m => m.mountPoint === "/mnt/backup disk"), { mountPoint: "/mnt/backup disk", filesystem: "xfs" });
});

test("Linux: data and removable disks are drives; the system, system directories and virtual filesystems are not", () => {
  const mounts = parseMountInfo(MOUNTINFO);
  for (const ok of ["/data", "/mnt/backup disk", "/media/me/USB"]) assert.equal(linuxDrive(ok, mounts), true, ok);
  for (const no of ["/", "/boot/efi", "/run/user/1000", "/var/lib/postgres", "/srv/overlay", "/data/sub", "/nowhere"]) assert.equal(linuxDrive(no, mounts), false, no);
});

test("macOS: only a direct child of /Volumes is a drive", () => {
  assert.equal(isShareableDriveRoot("/Volumes/External2TB", "darwin"), true);
  for (const no of ["/Volumes", "/Volumes/External2TB/Folder", "/Users/me", "/", "relative"]) assert.equal(isShareableDriveRoot(no, "darwin"), false, no);
});

test("Windows: only a bare drive letter is a drive", () => {
  assert.equal(isShareableDriveRoot("D:\\", "win32"), true);
  for (const no of ["D:\\Folder", "\\\\server\\share", "D:"]) assert.equal(isShareableDriveRoot(no, "win32"), false, no);
});

test("shareableDrive fails closed when the Linux mount table is unreadable", async () => {
  assert.equal(await shareableDrive("/data", "linux", async () => []), false);
  assert.equal(await shareableDrive("/data", "linux", async () => parseMountInfo(MOUNTINFO)), true);
});
