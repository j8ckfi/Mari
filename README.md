# Mari

A native macOS desktop client for agent CLIs, built with Tauri 2 + React. Mari
wraps a CLI's programmatic mode in a calm, fast chat surface: streaming that
feels alive, per-session background agents, a searchable model picker, and a
blank-slate aesthetic.

It ships wired to
**[Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)**
(`pi --mode rpc`), with adapters for **Claude Code** (stream-json) and a
zero-dependency **mock** backend — and it's built to be forked: point it at
*your* agent CLI by writing one adapter file.

> Status: pre-1.0, single-author. The UI is deep on the chat surface; the rest
> is wired up and improving.

## Fork it for your agent

The whole point. Any CLI with a JSONL/programmatic mode works:

1. Copy the template: `src/lib/adapters/mock/` → `src/lib/adapters/<your-cli>/`.
2. Implement the contract (`src/lib/agent/types.ts`): how to spawn, wire
   events → neutral events, intents → wire commands, a capabilities object.
3. Point `src/config.ts` at your adapter.

Guide: **[docs/ADAPTERS.md](docs/ADAPTERS.md)**. Working references:
`src/lib/adapters/pi/` (full-featured) and `src/lib/adapters/claude-code/`.
Then read [AGENTS.md](AGENTS.md) for what else to change (notably: rewrite
[docs/FRONTEND.md](docs/FRONTEND.md) to *your* design language).

## Requirements

Mari drives your existing CLI install — it does **not** bundle Pi, Node, or
your model credentials.

- **Pi** installed and configured: `npm i -g @earendil-works/pi-coding-agent`
  (Mari looks for `pi` on your PATH / `~/.local/bin`; configure a different
  path in Settings). Your providers/models are whatever `pi` already has.
- **Node** (Pi is a `#!/usr/bin/env node` script) and **[Bun](https://bun.sh)**
  (package manager + the dev bridge runtime).
- **Rust** + **Xcode** (to build the Tauri app / regenerate the icon).

## Quick start

```sh
bun install

# The full desktop app (spawns the CLI via the Rust core):
bun run tauri dev

# Fast browser iteration (no native rebuild): run the dev bridge, then Vite.
bun run dev                 # Vite on :1420
bun dev/pi-bridge.ts        # WebSocket bridge on :4317 (spawns one CLI per session)

# No CLI at all? The mock backend streams a scripted response:
#   open http://localhost:1420/?agent=mock
```

The desktop app talks to the CLI through the Rust core (Tauri IPC). The
browser path swaps that for a small WebSocket bridge so you can iterate on the
UI without recompiling Rust. Same frontend, two transports — see
`src/lib/agent/transport.ts`.

## Tests

```sh
bun run test    # unit + fixture tests (reducer fold, adapter translation)
bun run e2e     # Playwright drives the real UI against the mock adapter
```

Both run in CI, plus typecheck and `cargo check`.

## What's inside

| Area | Where |
| --- | --- |
| The neutral contract (view model, events, adapter/transport interfaces) | `src/lib/agent/types.ts` |
| Streaming fold (parts, interleaving) + hydration builder | `src/lib/agent/reducer.ts` |
| Transports (Tauri IPC / WS bridge) | `src/lib/agent/transport.ts` |
| Backend adapters (Pi, Claude Code, mock) | `src/lib/adapters/` |
| The fork knob (active adapter) | `src/config.ts` |
| Session engine (one CLI process per session) | `src/hooks/useAgentSession.ts` |
| Session manager / warm pool / tab mounting | `src/App.tsx` |
| Rust process host (spawn, JSONL, PATH fix, fs watch) | `src-tauri/src/pi.rs` |
| Chat surface (composer, conversation, pickers) | `src/components/chat/` |
| Settings (persistence + panel) | `src/lib/settings.ts`, `src/components/chat/SettingsDialog.tsx` |
| App icon source + pipeline | `src-tauri/icons/source/` |

For architecture, conventions, and the non-obvious bits, start at
**[AGENTS.md](AGENTS.md)** → `docs/`.

## Settings

Gear in the sidebar footer: theme (system/light/dark), default working dir,
default model + thinking level, the CLI binary path + extra PATH dirs (fixes
"disconnected" when launched from `/Applications`), and the warm-session-pool
size. Persisted in `localStorage`.

## Updates

Auto-updates ship via GitHub Releases (signed with Tauri's updater key).
Toggle in Settings → About. See
[AGENTS.md](AGENTS.md#releases--updates) for cutting a release.

## License

TBD.
