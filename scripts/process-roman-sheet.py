"""Assemble and cut the six transparent Roman map sprites.

The checked-in source sheet has six 400x340 cells in reading order. Run this
script without arguments to recut the six game assets from that sheet. Pass six
RGBA PNG paths to rebuild the sheet from individual illustrations first.
"""

from pathlib import Path
import struct
import sys
import zlib


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "public/img/map/villages/rome-antique"
SHEET = DEST / "source/rome-antique-levels-plaque-transparent.png"
CELL_W, CELL_H = 400, 340
SHEET_W, SHEET_H = CELL_W * 3, CELL_H * 2
TARGETS = [(224, 146), (265, 214), (304, 234), (307, 235), (332, 257), (325, 258)]
# The artwork must nearly fill the PNG, as it does in Beige/Blanc et bleu.
# The existing CSS inset already makes levels 1 and 2 smaller on the map.
FILL = [.98, .98, .965, .975, .985, .99]


def chunks(data):
    offset = 8
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        yield kind, data[offset + 8:offset + 8 + size]
        offset += size + 12


def read_png(path):
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"Not a PNG: {path}")
    compressed = bytearray()
    for kind, value in chunks(data):
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", value)
            if (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
                raise ValueError(f"Expected non-interlaced RGBA PNG: {path}")
        elif kind == b"IDAT":
            compressed.extend(value)
    raw = zlib.decompress(compressed)
    stride = width * 4
    rows = []
    previous = bytearray(stride)
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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(scanlines, 9)) + chunk(b"IEND", b""))


def bounds(rows, width, height):
    left, top, right, bottom = width, height, -1, -1
    for y, row in enumerate(rows):
        for x in range(width):
            if row[4 * x + 3] >= 16:
                left, right = min(left, x), max(right, x)
                top, bottom = min(top, y), max(bottom, y)
    if right < left:
        raise ValueError("Sprite has no visible pixels")
    return left, top, right + 1, bottom + 1


def sample(rows, width, height, x, y):
    x = max(0, min(width - 1, x))
    y = max(0, min(height - 1, y))
    x0, y0 = int(x), int(y)
    fx, fy = x - x0, y - y0
    channels = [0.0] * 4
    for yy, wy in ((y0, 1 - fy), (min(y0 + 1, height - 1), fy)):
        for xx, wx in ((x0, 1 - fx), (min(x0 + 1, width - 1), fx)):
            idx = xx * 4
            alpha = rows[yy][idx + 3] / 255
            weight = wx * wy
            for c in range(3):
                channels[c] += rows[yy][idx + c] * alpha * weight
            channels[3] += alpha * weight
    if channels[3] < 12 / 255:
        return b"\0\0\0\0"
    rgb = [max(0, min(255, round(channels[c] / channels[3]))) for c in range(3)]
    return bytes(rgb + [round(channels[3] * 255)])


def normalized_sprite(path, level):
    width, height, source = read_png(path)
    left, top, right, bottom = bounds(source, width, height)
    target_w, target_h = TARGETS[level - 1]
    fill = FILL[level - 1]
    drawn_w = round((target_w - 4) * fill)
    drawn_h = round((target_h - 4) * fill)
    origin_x = (target_w - drawn_w) // 2
    origin_y = target_h - drawn_h - 2
    rows = [bytearray(target_w * 4) for _ in range(target_h)]
    for y in range(drawn_h):
        source_y = top + (y + .5) * (bottom - top) / drawn_h - .5
        for x in range(drawn_w):
            source_x = left + (x + .5) * (right - left) / drawn_w - .5
            pixel = sample(source, width, height, source_x, source_y)
            offset = (origin_x + x) * 4
            rows[origin_y + y][offset:offset + 4] = pixel
    return rows


def assemble(paths):
    sheet = [bytearray(SHEET_W * 4) for _ in range(SHEET_H)]
    for level, path in enumerate(paths, 1):
        target_w, target_h = TARGETS[level - 1]
        sprite = normalized_sprite(path, level)
        cell_x = (level - 1) % 3 * CELL_W
        cell_y = (level - 1) // 3 * CELL_H
        x = cell_x + (CELL_W - target_w) // 2
        y = cell_y + CELL_H - target_h - 16
        for row_number, row in enumerate(sprite):
            sheet[y + row_number][x * 4:(x + target_w) * 4] = row
    write_png(SHEET, SHEET_W, SHEET_H, sheet)


def cut():
    width, height, rows = read_png(SHEET)
    if (width, height) != (SHEET_W, SHEET_H):
        raise ValueError(f"Expected a {SHEET_W}x{SHEET_H} source sheet")
    for level, (target_w, target_h) in enumerate(TARGETS, 1):
        cell_x = (level - 1) % 3 * CELL_W
        cell_y = (level - 1) // 3 * CELL_H
        x = cell_x + (CELL_W - target_w) // 2
        y = cell_y + CELL_H - target_h - 16
        sprite = [row[x * 4:(x + target_w) * 4] for row in rows[y:y + target_h]]
        write_png(DEST / f"level-{level}.png", target_w, target_h, sprite)
        box = bounds(sprite, target_w, target_h)
        print(f"level-{level}: {target_w}x{target_h}, visible {box[2]-box[0]}x{box[3]-box[1]}")


if __name__ == "__main__":
    if len(sys.argv) == 7:
        assemble([Path(name) for name in sys.argv[1:]])
    elif len(sys.argv) != 1:
        raise SystemExit("Usage: process-roman-sheet.py [six generated PNG paths]")
    cut()
