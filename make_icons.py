from PIL import Image, ImageDraw
import math

WATER_DEEP = (18, 59, 61)
WATER = (30, 110, 107)
REDSIDE = (196, 68, 42)
PAPER = (234, 252, 251)
SAGE = (138, 154, 123)


def rounded(size, radius_frac, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_frac)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=fill)
    return img


def draw_fish(img, ss):
    """Draw a simple redside: body, tail, eye, and the crimson lateral stripe."""
    d = ImageDraw.Draw(img)
    s = img.size[0]
    cx, cy = s * 0.50, s * 0.53
    bw, bh = s * 0.44, s * 0.24  # body half-extents

    # body (paper-colored ellipse)
    d.ellipse([cx - bw, cy - bh, cx + bw, cy + bh], fill=PAPER)
    # tail (triangle at the left)
    tx = cx - bw * 0.92
    d.polygon([
        (tx, cy),
        (tx - s * 0.14, cy - s * 0.12),
        (tx - s * 0.14, cy + s * 0.12),
    ], fill=PAPER)
    # the crimson stripe — the signature — running the length of the body
    sw = max(2, int(s * 0.045))
    d.line([(tx - s * 0.10, cy), (cx + bw * 0.82, cy)], fill=REDSIDE, width=sw)
    # eye
    er = s * 0.028
    ex, ey = cx + bw * 0.55, cy - bh * 0.28
    d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=WATER_DEEP)


def make(size, maskable=False):
    pad = int(size * 0.12) if maskable else 0
    inner = size - 2 * pad
    if maskable:
        base = Image.new("RGBA", (size, size), WATER_DEEP + (255,))
        tile = rounded(inner, 0.0, WATER_DEEP + (255,))
    else:
        base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        tile = rounded(inner, 0.22, WATER_DEEP + (255,))
    # subtle water gradient overlay
    grad = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(inner):
        t = y / inner
        col = tuple(int(WATER[i] * (1 - t) + WATER_DEEP[i] * t) for i in range(3))
        gd.line([(0, y), (inner, y)], fill=col + (255,))
    mask = rounded(inner, 0.0 if maskable else 0.22, (255, 255, 255, 255)).split()[3]
    tile.paste(grad, (0, 0), mask)
    draw_fish(tile, inner)
    base.paste(tile, (pad, pad), tile)
    return base


for sz, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    make(sz).save(f"icons/{name}")
make(512, maskable=True).save("icons/icon-maskable-512.png")
print("icons written")
