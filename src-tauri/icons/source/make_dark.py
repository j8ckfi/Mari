#!/usr/bin/env python3
"""Compose the DARK-appearance master for the Mari icon.

actool only emits the light appearance as a standalone icns, so we build the
dark variant: the star (cropped from the clean icon_11.png, scaled/placed to the
geometry actool measured from the .icon) filled with the dark-appearance cool
gradient, on a dark material tile, with the neutral emboss shadow.
"""
from PIL import Image, ImageDraw, ImageFilter

STAR = "/Users/j8ck/Documents/MariIcon.icon/Assets/icon_11.png"
OUT = "/private/tmp/claude-501/-Users-j8ck-Mari/ef18a65d-629e-4ef6-a3dc-5c34e9dbc8c4/scratchpad/dark_master.png"

S = 1024
TILE = 824
OFF = (S - TILE) // 2          # 100
RADIUS = 186

# Star placement measured from actool's render, mapped 256→1024:
STAR_W = 820                   # visible width fills the tile
STAR_CX, STAR_CY = 512, 576    # centred horizontally, slightly low

# Dark-appearance star gradient (display-p3 → approx sRGB), cool light.
G0 = (200, 209, 223)
G1 = (235, 243, 247)
# Dark material tile gradient.
T0 = (44, 44, 48)
T1 = (24, 24, 27)

canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# ── Dark tile ──────────────────────────────────────────────────────────────
grad = Image.new("RGB", (1, TILE))
for y in range(TILE):
    t = y / (TILE - 1)
    grad.putpixel((0, y), tuple(round(T0[i] + (T1[i] - T0[i]) * t) for i in range(3)))
grad = grad.resize((TILE, TILE))
mask = Image.new("L", (TILE, TILE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, TILE - 1, TILE - 1], radius=RADIUS, fill=255)
tile = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
tile.paste(grad, (0, 0), mask)

# Subtle ambient shadow under the tile.
sh_mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(sh_mask).rounded_rectangle(
    [OFF, OFF + 12, OFF + TILE, OFF + TILE + 12], radius=RADIUS, fill=90)
sh = Image.composite(
    Image.new("RGBA", (S, S), (0, 0, 0, 255)),
    Image.new("RGBA", (S, S), (0, 0, 0, 0)), sh_mask,
).filter(ImageFilter.GaussianBlur(18))
canvas = Image.alpha_composite(canvas, sh)
canvas.paste(tile, (OFF, OFF), tile)

# ── Star ─────────────────────────────────────────────────────────────────
star = Image.open(STAR).convert("RGBA")
star = star.crop(star.getbbox())               # tight to the visible shape
scale = STAR_W / star.width
sh_h = round(star.height * scale)
star = star.resize((STAR_W, sh_h), Image.LANCZOS)
alpha = star.split()[3]

# Cool light diagonal gradient, sized to the star, masked by its alpha.
sg = Image.new("RGB", (STAR_W, sh_h))
for y in range(sh_h):
    for_t = y / (sh_h - 1)
    # subtle diagonal: blend by y mostly (bottom→top lighter)
    row = tuple(round(G0[i] + (G1[i] - G0[i]) * (1 - for_t)) for i in range(3))
    for x in range(STAR_W):
        sg.putpixel((x, y), row)
star_rgba = Image.new("RGBA", (STAR_W, sh_h), (0, 0, 0, 0))
star_rgba.paste(sg, (0, 0), alpha)

gx = STAR_CX - STAR_W // 2
gy = STAR_CY - sh_h // 2

# Neutral emboss shadow beneath the star (opacity ~0.5).
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sstar = Image.composite(
    Image.new("RGBA", (STAR_W, sh_h), (0, 0, 0, 255)),
    Image.new("RGBA", (STAR_W, sh_h), (0, 0, 0, 0)), alpha)
shadow.paste(sstar, (gx, gy + 12), sstar)
shadow = shadow.filter(ImageFilter.GaussianBlur(14))
shadow.putalpha(shadow.split()[3].point(lambda a: int(a * 0.5)))
canvas = Image.alpha_composite(canvas, shadow)

canvas.paste(star_rgba, (gx, gy), star_rgba)
canvas.save(OUT)
print("wrote", OUT, canvas.size)
