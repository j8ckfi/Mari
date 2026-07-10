# Mari

A native macOS desktop client for CLI coding agents, built with Tauri 2 + React.

Mari is two things:

1. **A frontend for [Pi](https://www.pi.dev)** —
   a calm, fast chat surface over `pi --mode rpc`: streaming that feels alive,
   background agents per session, a searchable model picker. Modular, so it
   fits around your plugins and setup.
2. **A forkable frontend system for *any* agent CLI.** Any CLI with a
   JSONL/programmatic mode can become a beautiful, performant desktop app by
   writing one adapter file. Claude Code support and a zero-dependency mock
   backend ship as working references.

> Status: pre-1.0, single-author. Everything here is subject to improvement.
> If you find something weird, get your agent to open an issue!

## Fork it for your agent

Give it this repo and tell it what you want to build. That's pretty much it,
honestly. My advice is to come in with a strong brand direction and mockups
([mockdown.design](https://www.mockdown.design/) is great) — but these things
are smart.

### If you're an agent

1. Copy the template: `src/lib/adapters/mock/` → `src/lib/adapters/<your-cli>/`
2. Implement the contract in `src/lib/agent/types.ts` — spawn, wire
   events → neutral events, intents → wire commands, capabilities
3. Point `src/config.ts` at your adapter

Full guide: **[docs/ADAPTERS.md](docs/ADAPTERS.md)**. References:
`src/lib/adapters/pi/` (full-featured), `src/lib/adapters/claude-code/`.
Then see [AGENTS.md](AGENTS.md) — notably, rewrite
[docs/FRONTEND.md](docs/FRONTEND.md) to *your* design language.

## Requirements

Mari drives your existing CLI install — it doesn't bundle Pi, Node, or
credentials.

- **Pi**: `npm i -g @earendil-works/pi-coding-agent` (found on PATH /
  `~/.local/bin`, or set a path in Settings)
- **Node** + **[Bun](https://bun.sh)** (package manager + dev bridge runtime)
- **Rust** + **Xcode** (to build the app)

## Quick start

```sh
bun install

# Full desktop app:
bun run tauri dev

# Fast browser iteration (no Rust rebuild):
bun run dev                 # Vite on :1420
bun dev/pi-bridge.ts        # WS bridge on :4317

# No CLI? Mock backend: http://localhost:1420/?agent=mock
```

Same frontend, two transports: Tauri IPC in the app, a WebSocket bridge in
the browser — see `src/lib/agent/transport.ts`.

## Tests

```sh
bun run test    # unit + fixture tests
bun run e2e     # Playwright against the mock adapter
```

## Architecture

| Area | Where |
| --- | --- |
| Neutral contract (view model, events, interfaces) | `src/lib/agent/types.ts` |
| Streaming fold + hydration | `src/lib/agent/reducer.ts` |
| Transports (Tauri IPC / WS bridge) | `src/lib/agent/transport.ts` |
| Adapters (Pi, Claude Code, mock) | `src/lib/adapters/` |
| The fork knob | `src/config.ts` |
| Session engine (one CLI process per session) | `src/hooks/useAgentSession.ts` |
| Rust process host | `src-tauri/src/pi.rs` |
| Chat surface | `src/components/chat/` |

Deep dive: **[AGENTS.md](AGENTS.md)** → `docs/`.

## License

[MIT](LICENSE).
