#!/usr/bin/env python3
"""Draw Cuewell's app icon: a waveform sitting on an edit timeline."""

import math
import struct
import zlib
from pathlib import Path

OUT = 1024
SCALE = 4
N = OUT * SCALE

BG = (22, 19, 15, 255)
AMBER = (227, 154, 69, 255)
LINE = (62, 52, 42, 255)
HEAD = (246, 241, 232, 255)


def sdf_round_rect(px, py, x, y, w, h, radius):
    cx = x + w / 2
    cy = y + h / 2
    qx = abs(px - cx) - (w / 2 - radius)
    qy = abs(py - cy) - (h / 2 - radius)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - radius


def paint(buffer, color, contains):
    for y in range(N):
        row = y * N
        py = (y + 0.5) / SCALE
        for x in range(N):
            if contains(x, y, (x + 0.5) / SCALE, py):
                buffer[row + x] = color


def main():
    buffer = [0] * (N * N)
    paint(buffer, BG, lambda x, y, px, py: sdf_round_rect(px, py, 0, 0, OUT, OUT, 228) <= 0)

    bar_w = 72
    gap = 40
    heights = [132, 236, 372, 188, 286]
    total = bar_w * len(heights) + gap * (len(heights) - 1)
    left = (OUT - total) / 2
    line_y = 640

    def bar_contains(x, y, px, py):
        cursor = left
        for height in heights:
            if sdf_round_rect(px, py, cursor, line_y - height, bar_w, height, 18) <= 0:
                return True
            cursor += bar_w + gap
        return False

    paint(buffer, AMBER, bar_contains)
    paint(
        buffer,
        LINE,
        lambda x, y, px, py: sdf_round_rect(px, py, 168, line_y + 16, OUT - 336, 18, 9) <= 0,
    )

    third = left + (bar_w + gap) * 2 + bar_w / 2
    paint(
        buffer,
        HEAD,
        lambda x, y, px, py: sdf_round_rect(px, py, third - 7, line_y - heights[2] - 36, 14, heights[2] + 86, 7) <= 0,
    )

    pixels = bytearray(OUT * OUT * 4)
    samples = SCALE * SCALE
    for y in range(OUT):
        for x in range(OUT):
            r = g = b = a = 0
            for sy in range(SCALE):
                row = (y * SCALE + sy) * N
                for sx in range(SCALE):
                    color = buffer[row + x * SCALE + sx]
                    if color == 0:
                        continue
                    r += color[0]
                    g += color[1]
                    b += color[2]
                    a += color[3]
            i = (y * OUT + x) * 4
            pixels[i] = r // samples
            pixels[i + 1] = g // samples
            pixels[i + 2] = b // samples
            pixels[i + 3] = a // samples

    root = Path(__file__).resolve().parents[1]
    destination = root / "plugin" / "com.cuewell.resolve" / "ui" / "icon.png"
    destination.write_bytes(png(pixels, OUT, OUT))
    print(destination)


def png(pixels, width, height):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        start = y * stride
        raw.extend(pixels[start:start + stride])
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    main()
