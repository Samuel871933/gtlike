"""Extract the tower from the site's actual PNG logo and export favicon sizes."""

from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / "public"
LOGO = ROOT / "img/brand/adarma-logo-cream.png"
BACKGROUND = (27, 23, 21)


def chunks(data):
    offset = 8
    while offset < len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        yield kind, data[offset + 8:offset + 8 + length]
        offset += 12 + length


def read_rgba(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Source logo must be a PNG")
    width = height = None
    compressed = bytearray()
    for kind, value in chunks(data):
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", value)
            if (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
                raise ValueError("Source logo must be an 8-bit non-interlaced RGBA PNG")
        elif kind == b"IDAT":
            compressed.extend(value)
    raw = zlib.decompress(compressed)
    stride = width * 4
    rows = []
    previous = bytearray(stride)
    position = 0
    for _ in range(height):
        filter_type = raw[position]
        position += 1
        row = bytearray(raw[position:position + stride])
        position += stride
        for index in range(stride):
            left = row[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                estimate = left + above - upper_left
                distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
                predictor = (left, above, upper_left)[distances.index(min(distances))]
            elif filter_type == 0:
                predictor = 0
            else:
                raise ValueError(f"Unsupported PNG filter: {filter_type}")
            row[index] = (row[index] + predictor) & 255
        rows.append(row)
        previous = row
    return width, height, rows


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def render(size, rows):
    # The first 338 columns of the 1839x362 logo contain the tower mark.
    # Fit that exact cutout inside a square, leaving room around the battlements.
    source_size = 440
    offset_x, offset_y = 51, 39
    output = bytearray()
    samples = 4
    for y in range(size):
        output.append(0)
        for x in range(size):
            totals = [0, 0, 0]
            for sy in range(samples):
                for sx in range(samples):
                    source_x = int((x + (sx + .5) / samples) * source_size / size) - offset_x
                    source_y = int((y + (sy + .5) / samples) * source_size / size) - offset_y
                    if 0 <= source_x < 338 and 0 <= source_y < 362:
                        pixel = rows[source_y][source_x * 4:source_x * 4 + 4]
                        alpha = pixel[3]
                        color = tuple((pixel[channel] * alpha + BACKGROUND[channel] * (255 - alpha)) // 255 for channel in range(3))
                    else:
                        color = BACKGROUND
                    for channel in range(3):
                        totals[channel] += color[channel]
            output.extend(round(value / (samples * samples)) for value in totals)
    ihdr = struct.pack(">2I5B", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(output, 9)) + png_chunk(b"IEND", b"")


def main():
    width, height, rows = read_rgba(LOGO)
    if (width, height) != (1839, 362):
        raise ValueError("Logo dimensions changed; update the favicon crop")
    images = {size: render(size, rows) for size in (16, 32, 48, 180)}
    (ROOT / "favicon-32x32.png").write_bytes(images[32])
    (ROOT / "favicon-48x48.png").write_bytes(images[48])
    (ROOT / "apple-touch-icon.png").write_bytes(images[180])
    sizes = (16, 32, 48)
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + len(sizes) * 16
    directory = bytearray()
    for size in sizes:
        directory.extend(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(images[size]), offset))
        offset += len(images[size])
    (ROOT / "favicon.ico").write_bytes(header + directory + b"".join(images[size] for size in sizes))


if __name__ == "__main__":
    main()
