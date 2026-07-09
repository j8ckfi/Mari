# AGENTS.md — read this first

Mari is a desktop frontend for **agent CLIs**. It ships wired to
[Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), but the
repo's real objective is to be **the easiest possible way to put a polished
face on ANY agent CLI that has a programmatic/JSONL mode**: fork → write one
adapter file → go.

If you're an agent (or human) dropped in blind, this file is the map. Deep
dives live in `docs/`:

| Doc | What it covers |
| --- | --- |
| [docs/ADAPTERS.md](docs/ADAPTERS.md) | **The one seam.** How to point Mari at a new agent CLI, step by step. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Dataflow, session model, the two runtimes, the hosts, invariants. |
| [docs/FRONTEND.md](docs/FRONTEND.md) | The design system: shape, motion, surfaces, component landmarks. |

---

## Forking: what to change, what to keep

- **Change `src/config.ts`** — the fork knob. Import your adapter, set `agent`.
- **Write your adapter in `src/lib/adapters/<your-cli>/`** — copy
  `src/lib/adapters/mock/` (smallest complete example) and follow
  [docs/ADAPTERS.md](docs/ADAPTERS.md). `pi/` is the full-featured reference,
  `claude-code/` a second real-world example.
- **Rewrite [docs/FRONTEND.md](docs/FRONTEND.md)** — this is important and
  easy to get wrong: FRONTEND.md documents *Mari's* design taste (its radii,
  motion rules, restraint). It is **not gospel for your fork** — it's the
  design contract agents working on *this* repo follow. When you fork and
  develop your own look, **replace that file with your own design language**,
  so agents building your fork follow *your* rules instead of inheriting
  Mari's. A fork that keeps FRONTEND.md unedited will forever get PRs that
  look like Mari.
- **Keep `src/lib/agent/`** — the neutral core (view model, reducer,
  transports, engine hook). It's backend-agnostic by construction; if you find
  yourself editing it to make your CLI fit, the change probably belongs in
  your adapter. Genuine gaps in the contract → extend the core, add a test.

## The shape of the system

```
                    (one per open session/tab)
┌─ your CLI ──► stdout JSONL ──► Transport ──► AdapterSession.handleLine()
│   child                        (Tauri IPC          │  wire → AgentEvent[]
│                                 or WS bridge)      ▼
│                                              core reducer  ──► ChatItem[]
│                                              (src/lib/agent/reducer.ts)   │
│                                                                           ▼
└── stdin  ◄── Transport.send ◄── adapter intents ◄── UI actions ◄── React components
               (prompt / abort / setModel / …)
```

- Everything protocol-shaped lives in an **adapter** (`src/lib/adapters/*`).
- Everything rendering-shaped consumes the **neutral view model**
  (`ChatItem` et al. in `src/lib/agent/types.ts`). No component ever sees a
  wire event.
- The **capabilities object** on your adapter gates UI chrome: no `models`
  capability → no model picker renders, and so on. A minimal adapter
  (spawn + prompt + streamed text) yields a complete working app.
- Hosts (the Rust core / dev bridge) are **protocol-blind**: they spawn the
  `SpawnSpec` your adapter builds (`bin` + `args` + `cwd`) and shuttle JSONL
  lines. The only Pi-specific host code is the sidebar's session-store
  listing, kept at the bottom of `src-tauri/src/pi.rs`.

## Dev loops

- **UI-only work:** `bun run dev` (Vite :1420) + `bun dev/pi-bridge.ts`
  (WS bridge :4317, spawns one CLI child per session). Fast, no Rust rebuild.
  `.claude/launch.json` has a `mari-preview` config (port 5199) for the
  Claude Preview MCP.
- **No backend at all:** open `/?agent=mock` — the mock adapter streams a
  scripted response with zero external dependencies. Ideal for pure UI work
  and what the e2e suite drives.
- **Adapter selection in dev:** `?agent=pi|mock|claude-code` URL param or
  `VITE_AGENT=…` env (see `src/config.ts`). Forks change the default import.
- **Anything touching Rust (`src-tauri/`):** `bun run tauri dev`, or
  `tauri build` + install (below). Rust does **not** hot-reload.
- Working Pi providers vary by environment; `openai-codex/gpt-5.5` is a
  reliable default (`VITE_PI_MODEL` overrides). The local Laguna default is
  often down.

## Tests — run them, extend them

```sh
bun run test   # unit + fixture tests (tests/): reducer fold, adapter translation
bun run e2e    # Playwright against the real UI + mock adapter (e2e/)
bunx tsc --noEmit                                  # typecheck
cargo check --manifest-path src-tauri/Cargo.toml   # Rust core
```

CI (`.github/workflows/ci.yml`) runs all four. House rules:

- **New adapter → new fixture test.** Record/craft a wire-event stream, fold
  it through `createSession().handleLine` + the core reducer, assert the
  `ChatItem`s (see `tests/pi-adapter.test.ts` for the pattern).
- **Core reducer changes → cover them in `tests/reducer.test.ts`.** That file
  is the contract every backend relies on.
- The e2e suite needs no credentials — keep it that way (it drives the mock).

## Gotchas cheat-sheet (hard-won, don't relearn)

- **Process keys are `crypto.randomUUID()`** (`nextKey()` in App.tsx), never a
  module counter — HMR resets module state while React keeps live tabs, and a
  reissued key renders two panes at once.
- **No React StrictMode** (main.tsx): it double-invokes effects, which would
  spawn/kill the stateful CLI subprocess twice on mount.
- **"Won't connect from the installed app" → suspect PATH first.** GUI apps
  launched from Finder get a bare PATH. The fix (login-shell probe + fallback
  dirs, generic bare-bin resolution) lives in `src-tauri/src/pi.rs`
  (`augmented_path`, `resolve_bin`). Pull `pi://stderr` to confirm before
  assuming credentials.
- **Malformed content must never white-screen.** Adapters normalize wire
  content (string | array | missing — see `normContent` in the Pi adapter);
  each session is wrapped in an error boundary so one bad transcript takes
  down only itself. Preserve both layers.
- **Session-store parsing has three mirrors:** `store-format.ts` (TS),
  `dev/pi-bridge.ts` (reads disk with it), `src-tauri/src/pi.rs` (Rust port).
  Change one → change all three (tests cover the TS one).
- **`pgrep` for bridge-spawned CLIs:** they show in `ps` as the bare binary,
  not the full arg string. Use `pgrep -P <bridge-pid>`.
- **Claude Preview MCP quirks:** the headless browser reports
  `window.innerHeight === 0`, so scroll/viewport-height behavior can't be
  trusted there — assert per-element geometry/classes instead, and verify true
  scrolling in the desktop app. Offcanvas sidebar content may be unmounted
  while collapsed; toggle it open before asserting on it.
- **Commit identity:** commits in this repo use
  `git -c user.name="Mari" -c user.email="dovakinvsalduin444444@gmail.com"`.
- **Foreground `sleep` is blocked** in the agent harness; use background tasks
  / until-loops to wait on conditions.

## Build / install (desktop)

```sh
bun run tauri build
# quit running app, replace the bundle, relaunch:
osascript -e 'tell application "Mari" to quit'
rm -rf /Applications/Mari.app
cp -R "src-tauri/target/release/bundle/macos/Mari.app" /Applications/Mari.app
killall Dock          # refresh the dock icon
open /Applications/Mari.app
```

`tauri dev` runs a bare binary (no bundle), so the dock icon only reflects a
bundled build.

### The app icon pipeline (learned the hard way)

The source is an Icon Composer `.icon` bundle at
`src-tauri/icons/source/MariIcon.icon`. **Do NOT hand-composite the icon** —
export the appearance you want straight from Icon Composer (File → Export,
1024), inset it to the macOS grid (~824/1024, centered), then
`bunx tauri icon <inset-master>.png`. Details in
`src-tauri/icons/source/README.md`. Dock not updating? `killall Dock`.

## Releases & updates

Auto-update = Tauri updater plugin + a signed GitHub Release carrying a
`latest.json` manifest.

- Signing keypair: `bunx tauri signer generate`. **Public key →
  tauri.conf.json. Private key + password → GitHub repo secrets**
  (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) — set via
  `gh secret set`, never committed. Losing the key means users reinstall once.
- **Cut a release:** bump the version in `package.json` **and**
  `src-tauri/tauri.conf.json` (keep them in sync), then
  `git tag vX.Y.Z && git push --tags`. `.github/workflows/release.yml`
  (tauri-action) builds/signs/publishes. Watch with `gh run watch`.
- **Not notarized** (deliberate, for now): first install needs right-click →
  Open, and unsigned auto-updates can occasionally be re-quarantined by
  Gatekeeper. If self-replace gets flaky, fall back to a "new version →
  download" nudge until notarization is added.

---

*Keep this file current: when you learn something the hard way, add it here or
to the right doc in `docs/`.*
