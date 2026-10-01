"""Cut the transparent 3 x 2 Egyptian village sheet into map sprites.

Run from anywhere with Python 3. No third-party dependencies are required.
The source has six isolated illustrations in reading order. Each is fitted
without changing its aspect ratio, centred, and anchored two pixels above the
bottom of its exact map PNG size.
"""

from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "public/img/map/villages/egyptien"
SOURCE = DEST / "source/egyptien-levels-plaque-transparent.png"
SOURCE_SIZE = (1665, 944)
# The transparent gaps fall at these coordinates in the source sheet.
COLUMNS = (0, 555, 1110, 1665)
ROWS = (0, 472, 944)
TARGETS = ((224, 146), (265, 214), (304, 234), (307, 235), (332, 257), (325, 258))
# Levels 5 and 6 need a substantially larger visible silhouette than 4 on the map.
FILL = (1.0, 1.0, .91, .94, 1.0, 1.0)


def chunks(data):
    pos = 8
    while pos < len(data):
        length = struct.unpack_from(">I", data, pos)[0]
        kind = data[pos + 4:pos + 8]
        yield kind, data[pos + 8:pos + 8 + length]
        pos += length + 12


def read_png(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG: {path}")
    compressed = bytearray()
    for kind, payload in chunks(data):
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
                raise ValueError("Source must be a non-interlaced 8-bit RGBA PNG")
        elif kind == b"IDAT":
            compressed.extend(payload)
    stride = width * 4
    raw = zlib.decompress(compressed)
    previous = bytearray(stride)
    rows = []
    pos = 0
    for _ in range(height):
        method = raw[pos]
        pos += 1
        row = bytearray(raw[pos:pos + stride])
        pos += stride
        for i in range(stride):
            left = row[i - 4] if i >= 4 else 0
            above = previous[i]
            corner = previous[i - 4] if i >= 4 else 0
            if method == 0:
                predictor = 0
            elif method == 1:
                predictor = left
            elif method == 2:
                predictor = above
            elif method == 3:
                predictor = (left + above) // 2
            elif method == 4:
                estimate = left + above - corner
                predictor = min((left, above, corner), key=lambda v: abs(estimate - v))
            else:
                raise ValueError(f"Unsupported PNG filter: {method}")
            row[i] = (row[i] + predictor) & 255
        rows.append(row)
        previous = row
    return width, height, rows


def write_png(path, width, height, rows):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    scanlines = b"".join(b"\0" + bytes(row) for row in rows)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(scanlines, 9)) + chunk(b"IEND", b""))


def bounds(rows, x0, y0, x1, y1):
    left, top, right, bottom = x1, y1, x0, y0
    for y in range(y0, y1):
        row = rows[y]
        for x in range(x0, x1):
            if row[x * 4 + 3] >= 16:
                left, top = min(left, x), min(top, y)
                right, bottom = max(right, x + 1), max(bottom, y + 1)
    if right <= left:
        raise ValueError("Empty source cell")
    return left, top, right, bottom


def sample(rows, width, height, x, y):
    x = max(0, min(width - 1, x))
    y = max(0, min(height - 1, y))
    x0, y0 = int(x), int(y)
    fx, fy = x - x0, y - y0
    channels = [0.0] * 4
    for yy, wy in ((y0, 1 - fy), (min(y0 + 1, height - 1), fy)):
        for xx, wx in ((x0, 1 - fx), (min(x0 + 1, width - 1), fx)):
            weight = wx * wy
            alpha = rows[yy][xx * 4 + 3] / 255
            for channel in range(3):
                channels[channel] += rows[yy][xx * 4 + channel] * alpha * weight
            channels[3] += alpha * weight
    if channels[3] < 12 / 255:
        return b"\0\0\0\0"
    return bytes([*(max(0, min(255, round(channels[i] / channels[3]))) for i in range(3)), round(channels[3] * 255)])


def main():
    width, height, source = read_png(SOURCE)
    if (width, height) != SOURCE_SIZE:
        raise ValueError(f"Expected a {SOURCE_SIZE[0]} x {SOURCE_SIZE[1]} source sheet")
    for index, (target_w, target_h) in enumerate(TARGETS):
        col, row = index % 3, index // 3
        left, top, right, bottom = bounds(source, COLUMNS[col], ROWS[row], COLUMNS[col + 1], ROWS[row + 1])
        scale = min((target_w - 4) * FILL[index] / (right - left), (target_h - 4) * FILL[index] / (bottom - top))
        drawn_w = round((right - left) * scale)
        drawn_h = round((bottom - top) * scale)
        start_x = (target_w - drawn_w) // 2
        start_y = target_h - drawn_h - 2
        result = [bytearray(target_w * 4) for _ in range(target_h)]
        for y in range(drawn_h):
            sy = top + (y + .5) * (bottom - top) / drawn_h - .5
            for x in range(drawn_w):
                sx = left + (x + .5) * (right - left) / drawn_w - .5
                result[start_y + y][(start_x + x) * 4:(start_x + x + 1) * 4] = sample(source, width, height, sx, sy)
        path = DEST / f"level-{index + 1}.png"
        write_png(path, target_w, target_h, result)
        box = bounds(result, 0, 0, target_w, target_h)
        print(f"{path.name}: {target_w} x {target_h}, visible {box[2]-box[0]} x {box[3]-box[1]}, base y={box[3]}")


if __name__ == "__main__":
    main()
