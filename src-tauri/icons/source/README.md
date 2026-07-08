# Mari app icon — source & regeneration

`MariIcon.icon/` is the Apple **Icon Composer** bundle (macOS 26, Xcode 26):
layered art + `icon.json` describing fills, shadow, translucency, and the
light/dark/tinted appearances. Tauri ships one static icon, so we render a
single appearance and slice it.

We ship the **dark appearance** (light star on a dark tile — best contrast).

## Why the extra step

`xcrun actool` renders the `.icon`, but for a standalone `.icns` it only emits
the **light** appearance; the dark pixels live inside an adaptive asset in the
compiled `Assets.car` that can't be cleanly extracted headlessly. So we use
actool's light render only to measure the exact star geometry, then composite
the dark variant (`make_dark.py`) with the dark-appearance gradient from
`icon.json` — matching Icon Composer's size/position, not guessed.

## Regenerate

```sh
# 1. Render light appearance (geometry reference only).
xcrun actool MariIcon.icon --compile /tmp/out --app-icon MariIcon \
  --target-device mac --platform macosx --minimum-deployment-target 26.0 \
  --output-partial-info-plist /tmp/p.plist
#    -> /tmp/out/MariIcon.icns ; extract its largest PNG for measuring.

# 2. Composite the dark master (uses the clean icon_11.png + dark gradient).
python3 make_dark.py            # -> mari_dark_master_1024.png

# 3. Slice the full icon set.
bunx tauri icon mari_dark_master_1024.png
```

If Icon Composer's dark preview ever diverges from `mari_dark_master_1024.png`,
re-check the star geometry (STAR_W / STAR_CX / STAR_CY in make_dark.py) against
a fresh actool render, or export the dark appearance from Icon Composer directly
and feed that PNG to `tauri icon` instead.
