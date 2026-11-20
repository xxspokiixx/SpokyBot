import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CONVERTER = join(import.meta.dirname, "..", "android-test", "linux", "xwd-to-png.py");

/** A ZPixmap XWD the way `xwd -root` writes one on a little-endian 24bpp display. */
function xwd(width: number, height: number, pixels: Array<[number, number, number]>): Buffer {
  const header = Buffer.alloc(100);
  header.writeUInt32BE(100, 0); // header_size
  header.writeUInt32BE(7, 4); // file_version
  header.writeUInt32BE(2, 8); // ZPixmap
  header.writeUInt32BE(24, 12); // pixmap_depth
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header.writeUInt32BE(0, 24); // xoffset
  header.writeUInt32BE(0, 28); // byte_order: LSBFirst
  header.writeUInt32BE(32, 32); // bitmap_unit
  header.writeUInt32BE(32, 36); // bitmap_bit_order
  header.writeUInt32BE(32, 40); // bitmap_pad
  header.writeUInt32BE(24, 44); // bits_per_pixel
  header.writeUInt32BE(width * 4, 48); // bytes_per_line
  header.writeUInt32BE(4, 52); // visual_class: TrueColor
  header.writeUInt32BE(0x00ff0000, 56); // red_mask
  header.writeUInt32BE(0x0000ff00, 60); // green_mask
  header.writeUInt32BE(0x000000ff, 64); // blue_mask
  header.writeUInt32BE(0, 68); // bits_per_rgb
  header.writeUInt32BE(8, 72); // colormap_entries
  header.writeUInt32BE(0, 76); // ncolors

  const body = Buffer.alloc(width * 4 * height);
  pixels.forEach(([r, g, b], index) => {
    // Little-endian BGRX, which is what a 24bpp LSBFirst ZPixmap stores.
    body.writeUInt32LE((r << 16) | (g << 8) | b, index * 4);
  });
  return Buffer.concat([header, body]);
}

describe("the guest's XWD to PNG converter", () => {
  const skip = process.platform === "win32" ? "python3 is not part of the Windows checkout" : false;

  it.skipIf(skip)("writes a PNG whose pixels are the ones the X server produced", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-xwd-"));
    try {
      const pixels: Array<[number, number, number]> = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
      const source = join(dir, "in.xwd");
      const target = join(dir, "out.png");
      writeFileSync(source, xwd(2, 2, pixels));
      execFileSync("python3", [CONVERTER, source, target]);
      const png = readFileSync(target);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      // IHDR is the first chunk: width and height follow the chunk's length and type.
      expect(png.readUInt32BE(16)).toBe(2);
      expect(png.readUInt32BE(20)).toBe(2);
      expect(png.readUInt8(24)).toBe(8);
      // PNG colour type 2 is truecolour, and the picture is fully opaque.
      expect(png.readUInt8(25)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
