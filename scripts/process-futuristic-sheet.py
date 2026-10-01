"""Cut the futuristic 3×2 sheet into transparent, bottom-anchored map sprites.

Uses only Python's standard library. The sheet has a 470px row divider because
the upper row's buildings end there and the lower row's antennas begin below it.
"""

from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/img/map/villages/futuriste/source/futuriste-levels-plaque-transparent.png"
OUTPUT = SOURCE.parent.parent
TARGETS = [(224, 146), (265, 214), (304, 234), (307, 235), (332, 257), (325, 258)]


def png_chunks(data):
    offset = 8
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        yield kind, data[offset + 8:offset + 8 + size]
        offset += 12 + size


def read_png(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("The source must be a PNG")
    compressed = bytearray()
    for kind, value in png_chunks(data):
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", value)
            if (width, height, depth, color, compression, filtering, interlace) != (1536, 1024, 8, 6, 0, 0, 0):
                raise ValueError("Expected a 1536×1024 non-interlaced RGBA sprite sheet")
        elif kind == b"IDAT":
            compressed.extend(value)
    raw = zlib.decompress(compressed)
    stride = width * 4
    rows = []
    previous = bytearray(stride)
    index = 0
    for _ in range(height):
        filter_kind = raw[index]
        index += 1
        row = bytearray(raw[index:index + stride])
        index += stride
        for i in range(stride):
            left = row[i - 4] if i >= 4 else 0
            above = previous[i]
            upper_left = previous[i - 4] if i >= 4 else 0
            if filter_kind == 0:
                predictor = 0
            elif filter_kind == 1:
                predictor = left
            elif filter_kind == 2:
                predictor = above
            elif filter_kind == 3:
                predictor = (left + above) // 2
            elif filter_kind == 4:
                estimate = left + above - upper_left
                distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
                predictor = (left, above, upper_left)[distances.index(min(distances))]
            else:
                raise ValueError(f"Unsupported PNG filter: {filter_kind}")
            row[i] = (row[i] + predictor) & 255
        rows.append(row)
        previous = row
    return rows


def content_box(rows, level):
    column = (level - 1) % 3
    x_start, x_end = column * 512, (column + 1) * 512
    y_start, y_end = (0, 470) if level <= 3 else (470, 1024)
    left, top, right, bottom = x_end, y_end, x_start, y_start
    for y in range(y_start, y_end):
        row = rows[y]
        for x in range(x_start, x_end):
            if row[x * 4 + 3] >= 16:
                left, top = min(left, x), min(top, y)
                right, bottom = max(right, x), max(bottom, y)
    if right < left:
        raise ValueError(f"Level {level} is empty")
    return left, top, right - left + 1, bottom - top + 1


def sample(rows, x, y):
    x = max(0, min(1535, x))
    y = max(0, min(1023, y))
    ix, iy = int(x), int(y)
    fx, fy = x - ix, y - iy
    result = [0.0, 0.0, 0.0, 0.0]
    for yy, wy in ((iy, 1 - fy), (min(iy + 1, 1023), fy)):
        row = rows[yy]
        for xx, wx in ((ix, 1 - fx), (min(ix + 1, 1535), fx)):
            weight = wx * wy
            index = xx * 4
            alpha = row[index + 3] / 255
            for channel in range(3):
                result[channel] += row[index + channel] * alpha * weight
            result[3] += alpha * weight
    return result


def make_sprite(rows, level, target):
    source_x, source_y, source_w, source_h = content_box(rows, level)
    target_w, target_h = target
    scale = min((target_w - 4) / source_w, (target_h - 4) / source_h)
    width, height = round(source_w * scale), round(source_h * scale)
    left = (target_w - width) // 2
    top = target_h - height - 2
    pixels = bytearray(target_w * target_h * 4)
    for y in range(height):
        for x in range(width):
            total = [0.0, 0.0, 0.0, 0.0]
            for sy in range(2):
                for sx in range(2):
                    u = source_x + (x + (sx + .5) / 2) * source_w / width - .5
                    v = source_y + (y + (sy + .5) / 2) * source_h / height - .5
                    color = sample(rows, u, v)
                    for channel in range(4):
                        total[channel] += color[channel] / 4
            alpha = max(0, min(255, round(total[3] * 255)))
            offset = ((top + y) * target_w + left + x) * 4
            if alpha:
                for channel in range(3):
                    pixels[offset + channel] = max(0, min(255, round(total[channel] / total[3])))
                pixels[offset + 3] = alpha
    # Supprime les résidus quasi transparents de la planche et les rares
    # particules isolées, sans toucher aux contours du bâtiment principal.
    for index in range(0, len(pixels), 4):
        if pixels[index + 3] < 16:
            pixels[index:index + 4] = b"\0\0\0\0"
    visited = set()
    for y in range(target_h):
        for x in range(target_w):
            start = y * target_w + x
            if start in visited or pixels[start * 4 + 3] == 0:
                continue
            component = []
            queue = [start]
            visited.add(start)
            while queue:
                current = queue.pop()
                component.append(current)
                cx, cy = current % target_w, current // target_w
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < target_w and 0 <= ny < target_h:
                        neighbor = ny * target_w + nx
                        if neighbor not in visited and pixels[neighbor * 4 + 3]:
                            visited.add(neighbor)
                            queue.append(neighbor)
            if len(component) < 8:
                for cell in component:
                    pixels[cell * 4:cell * 4 + 4] = b"\0\0\0\0"
    return pixels, width, height


def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


def save_png(path, width, height, pixels):
    scanlines = bytearray()
    stride = width * 4
    for y in range(height):
        scanlines.append(0)
        scanlines.extend(pixels[y * stride:(y + 1) * stride])
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(scanlines, 9)) + chunk(b"IEND", b""))


def main():
    rows = read_png(SOURCE)
    for level, target in enumerate(TARGETS, 1):
        pixels, width, height = make_sprite(rows, level, target)
        save_png(OUTPUT / f"level-{level}.png", *target, pixels)
        print(f"level-{level}: {target[0]}×{target[1]} px, illustration {width}×{height} px")


if __name__ == "__main__":
    main()
