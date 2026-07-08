#!/usr/bin/env python3
"""Compose a 1024x1024 macOS-style master icon from the Icon Composer layers.

The .icon bundle's visible layer is the hand-drawn spinning top (icon_23 2.png);
icon_11.png is flagged hidden. We render the light-appearance icon: a warm
off-white squircle tile with the dark glyph and a soft drop shadow. tauri icon
then slices this into .icns/.ico/PNGs.
"""
from PIL import Image, ImageDraw, ImageFilter

SRC = "/Users/j8ck/Documents/MariIcon.icon/Assets/icon_23 2.png"
OUT = "/private/tmp/claude-501/-Users-j8ck-Mari/ef18a65d-629e-4ef6-a3dc-5c34e9dbc8c4/scratchpad/mari_master.png"

S = 1024                      # canvas
TILE = 824                    # rounded-rect art area (Big Sur grid)
OFF = (S - TILE) // 2         # 100px margin
RADIUS = 186                  # macOS superellipse-ish corner radius

canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# ── Warm off-white vertical gradient, clipped to the rounded rect ──────────
top = (255, 253, 251)
bot = (238, 233, 228)
grad = Image.new("RGB", (1, TILE))
for y in range(TILE):
    t = y / (TILE - 1)
    grad.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
grad = grad.resize((TILE, TILE))

mask = Image.new("L", (TILE, TILE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, TILE - 1, TILE - 1], radius=RADIUS, fill=255)

tile = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
tile.paste(grad, (0, 0), mask)

# Soft ambient shadow under the tile (very subtle — Finder adds its own too).
tile_shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sh_mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(sh_mask).rounded_rectangle(
    [OFF, OFF + 10, OFF + TILE, OFF + TILE + 10], radius=RADIUS, fill=70)
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sh.putalpha(sh_mask)
sh = Image.composite(Image.new("RGBA", (S, S), (20, 18, 16, 255)),
                     Image.new("RGBA", (S, S), (0, 0, 0, 0)), sh_mask)
sh = sh.filter(ImageFilter.GaussianBlur(16))
canvas = Image.alpha_composite(canvas, sh)
canvas.paste(tile, (OFF, OFF), tile)

# ── The glyph: recolour the black art to near-black, keep its alpha ─────────
glyph = Image.open(SRC).convert("RGBA")
alpha = glyph.split()[3]
INK = (23, 22, 20)
glyph = Image.composite(
    Image.new("RGBA", glyph.size, INK + (255,)),
    Image.new("RGBA", glyph.size, (0, 0, 0, 0)),
    alpha,
)

# Scale to ~62% of the tile width, keep aspect, centre in the tile.
target_w = int(TILE * 0.62)
scale = target_w / glyph.width
target_h = int(glyph.height * scale)
glyph = glyph.resize((target_w, target_h), Image.LANCZOS)
gx = OFF + (TILE - target_w) // 2
gy = OFF + (TILE - target_h) // 2

# Soft drop shadow beneath the glyph (neutral, per the .icon's shadow spec).
g_alpha = glyph.split()[3]
gshadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gs = Image.new("RGBA", glyph.size, (0, 0, 0, 0))
gs = Image.composite(Image.new("RGBA", glyph.size, (10, 9, 8, 255)),
                     Image.new("RGBA", glyph.size, (0, 0, 0, 0)), g_alpha)
gshadow.paste(gs, (gx, gy + 10), gs)
gshadow = gshadow.filter(ImageFilter.GaussianBlur(12))
gshadow.putalpha(gshadow.split()[3].point(lambda a: int(a * 0.35)))
canvas = Image.alpha_composite(canvas, gshadow)

canvas.paste(glyph, (gx, gy), glyph)
canvas.save(OUT)
print("wrote", OUT, canvas.size)
