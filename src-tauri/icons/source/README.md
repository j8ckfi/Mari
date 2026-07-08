# Mari app icon — source & regeneration

`MariIcon.icon/` is the Apple **Icon Composer** bundle (macOS 26, Xcode 26).
Tauri ships one static icon, so we use a single exported appearance.

We ship the **dark appearance** (glossy silver star on a dark tile).

## The source of truth

`MariIcon-Dark-1024.png` is exported straight from **Icon Composer**
(File → Export → Dark, 1024×1024) — the real beveled/translucent render, not a
composite. Icon Composer's export is full-bleed (iOS style: tile fills the
canvas), so for the macOS grid we inset it to ~80% with transparent margins
(`mari_dark_master_1024.png`) before slicing.

Earlier attempts rendered the `.icon` with `xcrun actool` and hand-composited
the dark variant — but actool only emits the light appearance for a standalone
`.icns`, and the composite lost Icon Composer's gloss/emboss. Exporting from
Icon Composer directly is the correct path; keep doing that.

## Regenerate

```sh
# From a fresh Icon Composer "Dark" 1024 export named MariIcon-Dark-1024.png:
python3 - <<'PY'
from PIL import Image
src=Image.open("MariIcon-Dark-1024.png").convert("RGBA")
TILE, S = 824, 1024; off=(S-TILE)//2
c=Image.new("RGBA",(S,S),(0,0,0,0))
t=src.resize((TILE,TILE), Image.LANCZOS)
c.paste(t,(off,off),t)
c.save("mari_dark_master_1024.png")
PY
bunx tauri icon mari_dark_master_1024.png
```
