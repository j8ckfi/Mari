# Mari app icon — source & regeneration

`MariIcon.icon/` is the Apple **Icon Composer** bundle (macOS 26, Xcode 26):
layered art + `icon.json` describing fills, shadow, translucency, and the
light/dark/tinted appearances. Tauri can't consume it directly, so we render it
with the system's own compiler and slice the result.

## Regenerate

```sh
# 1. Render the .icon with Xcode's asset compiler (the real system renderer).
xcrun actool MariIcon.icon \
  --compile /tmp/out --app-icon MariIcon \
  --target-device mac --platform macosx --minimum-deployment-target 26.0 \
  --output-partial-info-plist /tmp/p.plist
#    -> /tmp/out/MariIcon.icns  (rendered; source art is 436px so it tops out
#       at 256px — the faithful ceiling. mari_render_256.png is that render.)

# 2. Upscale the render to a 1024 master and let tauri slice the full set.
#    (soft above 256 is inherent to the 436px source art.)
bunx tauri icon mari_master_1024.png
```

`mari_render_256.png` — the crisp system render. `mari_master_1024.png` — the
upscaled master fed to `tauri icon`.
