"""XWD to PNG without a library: the phone's rootfs ships python3 and x11-apps' xwd, and nothing else.

Python's zlib is in the standard library, and PNG is zlib plus a header and per-row filters, so the
guest needs no pillow, no imagemagick and no network. Usage: xwd-to-png.py IN.xwd OUT.png
"""
import struct
import sys
import zlib


def read_xwd(path):
    with open(path, "rb") as handle:
        data = handle.read()
    header = struct.unpack(">25I", data[:100])
    header_size = header[0]
    pixmap_width, pixmap_height = header[4], header[5]
    byte_order = header[7]
    bits_per_pixel = header[11]
    bytes_per_line = header[12]
    visual_class = header[13]
    red_mask, green_mask, blue_mask = header[14], header[15], header[16]
    ncolors = header[19]

    if header[2] != 2:
        raise ValueError("not a ZPixmap XWD")

    # xwd may prepend a colormap after the header; the pixels start after it.
    offset = header_size + ncolors * 12
    if byte_order == 1:
        raise ValueError("only little-endian XWD is supported")

    pixels = data[offset:]
    if len(pixels) < bytes_per_line * pixmap_height:
        raise ValueError("truncated XWD")

    def shift(mask):
        if not mask:
            return 0, 0
        low = (mask & -mask).bit_length() - 1
        return low, mask >> low

    rs, gs, bs = shift(red_mask), shift(green_mask), shift(blue_mask)
    step = bits_per_pixel // 8
    fmt = {1: "B", 2: "H", 3: "I", 4: "I"}[min(step, 4)]

    rows = []
    for y in range(pixmap_height):
        line = pixels[y * bytes_per_line:(y + 1) * bytes_per_line]
        row = bytearray(pixmap_width * 3)
        for x in range(pixmap_width):
            value = int.from_bytes(line[x * step:(x + 1) * step], "little")
            row[x * 3] = ((value & red_mask) >> rs[0]) * 255 // (rs[1] or 1)
            row[x * 3 + 1] = ((value & green_mask) >> gs[0]) * 255 // (gs[1] or 1)
            row[x * 3 + 2] = ((value & blue_mask) >> bs[0]) * 255 // (bs[1] or 1)
        rows.append(bytes(row))
    return pixmap_width, pixmap_height, rows


def write_png(path, width, height, rows):
    def chunk(kind, payload):
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    # Filter byte 0 (None) per scanline: the picture is written once, so a cheaper filter costs more than it saves.
    raw = b"".join(b"\x00" + row for row in rows)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: xwd-to-png.py IN.xwd OUT.png")
    width, height, rows = read_xwd(sys.argv[1])
    write_png(sys.argv[2], width, height, rows)


if __name__ == "__main__":
    main()
