# Architecture

How Mari runs: the layers, the session model, the two runtimes, and the
invariants that keep it from breaking. For the adapter contract specifically,
read [ADAPTERS.md](ADAPTERS.md).

## Layers

```
┌────────────────────────────────────────────────────────────────────┐
│ React components (src/components/, src/App.tsx)                    │
│   render ChatItem[], call session actions, gate chrome on          │
│   adapter capabilities                                             │
├────────────────────────────────────────────────────────────────────┤
│ Engine (src/hooks/useAgentSession.ts)                              │
│   one per open session: owns a transport + adapter session, folds  │
│   AgentEvents into the reducer, holds meta (model/identity/stats)  │
├────────────────────────────────────────────────────────────────────┤
│ Neutral core (src/lib/agent/)                                      │
│   types.ts     — the contract: ChatItem view model, AgentEvent     │
│                  vocabulary, AgentAdapter/Transport interfaces     │
│   reducer.ts   — THE streaming fold (parts, interleaving, timers)  │
│                  + TranscriptBuilder for hydration                 │
│   transport.ts — Tauri IPC + WS bridge transports, SpawnSpec       │
│   tool-meta.ts — shared tool→icon/label table                      │
│   thinking.ts  — model-aware thinking-level rules                  │
├────────────────────────────────────────────────────────────────────┤
│ Adapters (src/lib/adapters/{pi,claude-code,mock}/)                 │
│   wire protocol ↔ AgentEvents/intents; selected in src/config.ts   │
├────────────────────────────────────────────────────────────────────┤
│ Hosts (protocol-blind process runners)                             │
│   desktop: src-tauri/src/pi.rs — spawn SpawnSpec, JSONL ↔ events   │
│   browser dev: dev/pi-bridge.ts — same, over one WS per session    │
└────────────────────────────────────────────────────────────────────┘
```

The load-bearing property: **components never see wire events, adapters never
touch rendering state.** The reducer in between is written once and covered by
`tests/reducer.test.ts`.

## The rendering model

An assistant run is an **ordered list of parts**: `prose` (markdown segments)
and `work` (chunks of the thinking/tool timeline). Prose is positional — text
between two tool calls stays between them; the "answer" is simply the trailing
prose. Interleaving (prose → work → prose) falls out of the fold. This
replaced an older `steps[] + answer` model whose single answer slot silently
dropped interleaved narration.

Streaming text/thinking arrive as **cumulative snapshots**, not deltas —
idempotent by construction, so re-delivered or coalesced events can't
double-append. Delta protocols accumulate inside their adapter.

## Session model: one process per session (warm pool)

Most agent CLIs are one-session-per-process. Mari runs **one child per open
session** so background agents keep streaming when you navigate away.

- `src/App.tsx` is the **session manager**: tabs, the active key, per-engine
  status, and one mounted `<SessionEngine>` (→ `useAgentSession`) per tab.
  Background engines render nothing but keep folding their event stream.
- **Warm pool reaping** (App.tsx): keep the active tab + every *running*
  (streaming) tab + the last `settings.warmPoolSize` recently-viewed idle
  tabs; unmount (→ kill process) the rest. Running sessions are never reaped.
- **Process keys are `crypto.randomUUID()`** — never a module counter. HMR
  resets module state to 0 while React keeps the live tabs, so a counter
  reissues a colliding key and two panes render at once (the "stacked panes"
  bug).
- Each engine subtree sits in a class **error boundary** (`EngineBoundary`):
  a malformed transcript takes down only that session.

## Two runtimes, one frontend

The React app is transport-agnostic (`createHostTransport(key)`):

- **Desktop (Tauri):** the Rust core owns the children. Commands via
  `invoke("pi_start"|"pi_send"|"pi_stop")`; every child's stdout arrives on
  the single `pi://event` channel as `{key, line}` envelopes, demuxed by a
  module-level hub. `pi://started`/`pi://exit` carry the bare key.
- **Browser (dev):** `dev/pi-bridge.ts`, a Bun WS server on **:4317**, one
  socket per session, each spawning the `SpawnSpec` passed in its `spec`
  query param. Lets you iterate with Vite HMR and no Rust rebuild.
  `VITE_PI_BRIDGE_URL` overrides the URL.

Anything protocol-shaped must work through **both** transports (adapters get
this for free — they only see parsed lines). Adapters may also supply their
own transport entirely (`createTransport`); the mock adapter's is in-memory.

Hosts inject one synthetic line — `{type:"cwd", cwd}`, the resolved spawn
directory — because several CLIs never report it and the project breadcrumb
needs it.

## The `/Applications` PATH trap

A Finder-launched app inherits a **bare PATH** (`/usr/bin:/bin:…`). Agent
CLIs are `#!/usr/bin/env node` scripts living in `~/.local/bin` or similar,
so both the CLI and `node` are invisible → children die instantly → "Pi
disconnected."

The fix lives in `src-tauri/src/pi.rs`:

- `augmented_path()` — probe the login shell's PATH (`$SHELL -lc`,
  non-interactive so it can't hang, output markers to isolate from rc noise)
  plus a static fallback set (`~/.local/bin`, `~/.bun/bin`, homebrew, …),
  de-duped, cached for the process.
- `resolve_bin()` — bare binary names are resolved against that augmented
  PATH *by us*, because `Command::new` resolves against the parent's
  (bare) PATH, not the env we set on the child.
- Settings can prepend extra dirs / override the binary path
  (`SpawnOptions.binPath`/`pathDirs` → `SpawnSpec`).

**Any time a CLI "won't connect from the installed app," suspect PATH
first.** Pull `pi://stderr` to confirm before assuming credentials.

## Sidebar / session store

- The sidebar lists the adapter's `SessionStore` (`agent.sessions`) grouped by
  project (cwd). Order + collapsed-set persist in localStorage. Adapters
  without a store just show open tabs.
- **Durability:** on desktop a `notify` filesystem watcher in Rust emits
  `pi://sessions-changed` on ANY store change — a session written by a
  terminal CLI syncs into the sidebar within ~120ms (the frontend coalesces
  bursts). The browser path polls. Don't add a manual "refresh" button; keep
  the watch authoritative.
- Pi's store format is parsed in **three mirrored places** — keep in sync:
  `src/lib/adapters/pi/store-format.ts` (canonical, tested),
  `dev/pi-bridge.ts` (imports it for disk reads), `src-tauri/src/pi.rs`
  (Rust port).

## Settings

`src/lib/settings.ts` — a `SettingsProvider` over plain **localStorage**
(identical in the Tauri webview and browser dev; no store plugin, no Rust
round-trip). It also owns theme application (system/light/dark, live). Values
that must reach the host (binary path, extra PATH dirs) are read at
spawn-build time and travel inside the `SpawnSpec` — Rust stays stateless.
App version is injected via a Vite `define` (`__APP_VERSION__`).

## Invariants (the "doesn't break easy" list)

1. **Every run ends.** Adapters must emit `run-end` for every `run-start`,
   including error paths — a stuck streaming item is a protocol-translation
   bug, not a UI bug.
2. **Snapshots, not deltas**, for text/thinking (idempotency under
   re-delivery).
3. **Normalize hostile content in adapters** (string | array | missing);
   the error boundary is the last line of defense, not the first.
4. **No StrictMode** (double-invoked effects would double-spawn children).
5. **UUID process keys** (HMR collision, above).
6. **JSONL framing:** split on `\n` only. JS `String.split("\n")` and Rust's
   `lines()` are safe; readers that split on U+2028/U+2029 are not
   protocol-compliant.
