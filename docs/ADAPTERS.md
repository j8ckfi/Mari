# Writing an adapter

An adapter teaches Mari to drive one agent CLI. It is the **only** code you
must write to fork Mari for a different agent. Everything else — streaming
transcript, work traces, questions, sidebar, settings, the desktop shell —
comes for free.

The contract lives in [`src/lib/agent/types.ts`](../src/lib/agent/types.ts)
(`AgentAdapter`). Three implementations to crib from:

| Adapter | Use it as |
| --- | --- |
| [`src/lib/adapters/mock/`](../src/lib/adapters/mock/index.ts) | **The template.** Smallest complete adapter (~150 lines, no wire protocol). Copy this. |
| [`src/lib/adapters/claude-code/`](../src/lib/adapters/claude-code/index.ts) | A real CLI over bidirectional stream-json, ~300 lines. |
| [`src/lib/adapters/pi/`](../src/lib/adapters/pi/index.ts) | The full-featured reference: models, thinking levels, questions, fork, rename, stats, session store. |

## Prerequisite: what your CLI must have

A **programmatic mode speaking JSONL over stdio** (or anything you can bridge
to that): you write one JSON command per line to stdin, it emits one JSON
event per line on stdout. `pi --mode rpc`, `claude -p --input-format
stream-json --output-format stream-json`, codex's proto mode, etc.

If your CLI talks something else (a socket, HTTP), implement
`createTransport` (see [Custom transports](#custom-transports)) — the rest of
the adapter is unchanged.

## Step by step

1. **Copy the template.**
   `cp -r src/lib/adapters/mock src/lib/adapters/<your-cli>`
2. **Describe the launch** — `spawn(opts) → SpawnSpec`:
   ```ts
   spawn: (opts) => ({
     bin: opts.binPath || "your-cli",       // bare names resolve on the augmented PATH
     args: ["--jsonl", ...(opts.sessionPath ? ["--resume", opts.sessionPath] : [])],
     cwd: opts.cwd,
     pathDirs: opts.pathDirs,
   }),
   ```
   The hosts (Rust core on desktop, `dev/pi-bridge.ts` in the browser) spawn
   exactly this — they never inspect your flags.
3. **Translate incoming lines** — `createSession(ctx).handleLine(line)`
   returns neutral `AgentEvent`s. This is 80% of the work; see the
   [event vocabulary](#the-agentevent-vocabulary) below.
4. **Send intents** — `prompt` / `abort` / optional `respond`, `setModel`,
   `setThinkingLevel`, `fork`, `rename` call `ctx.send(command)` with your
   CLI's wire commands.
5. **Declare capabilities** — set to `false` anything your CLI can't do; the
   UI hides that chrome. Start with everything `false` except what you've
   implemented, and grow.
6. **Register it** in `src/config.ts` (add to `REGISTRY`, or replace the
   default `agent` export in a fork).
7. **Test it**: iterate live with `bun run dev` + `bun dev/pi-bridge.ts` and
   `/?agent=<your-cli>`, then add a fixture test (below).

## The AgentEvent vocabulary

Emit these from `handleLine` (full types in `src/lib/agent/types.ts`); the
core reducer handles all bookkeeping — parts, interleaving, timers:

| Event | Meaning |
| --- | --- |
| `run-start` / `run-end` | A run (user turn → settled answer) opened/closed. Every run **must** end — emit `run-end` on your CLI's terminal event, including errors. |
| `text` / `thinking` | **Cumulative snapshots** of the current segment, not deltas. `final: true` settles the segment. If your protocol streams deltas, accumulate in session state first (see the claude-code adapter). Snapshots are idempotent — a re-delivered event can't double-append. |
| `segment-break` | Message boundary within a run: the next `text`/`thinking` starts a fresh prose part / thinking step. |
| `step-start` / `step-update` / `step-end` | Tool-call lifecycle. Use `toolStepMeta(name, args)` from `src/lib/agent/tool-meta.ts` for icons/labels (it covers the common bash/read/edit/grep family, case-insensitively; pass overrides for your CLI's exotic tools). A `step-start` closes the open prose — later text renders below the work chunk. |
| `run-error` | Marks the current run errored (renders the red banner on the assistant item). |
| `question` / `question-resolved` | Blocking user input (select/confirm/input/editor). Answers come back through your `respond(id, answer)`. |
| `notice` / `notice-clear` | Banners. Give progress notices a `sticky` id ("compaction") so you can replace/clear them; transient ones just accumulate. |
| `queue` | Queued steering/follow-up messages. |
| `hydrate` | Replace the transcript wholesale (resuming a saved session). Build items with `TranscriptBuilder` (`src/lib/agent/reducer.ts`) — it routes prose/thinking/steps with the same ordering rules as the live fold, so a reload is pixel-identical. |
| `meta` | Out-of-band session metadata: `model`, `availableModels`, `thinkingLevel`, `identity` (file/id/name/cwd), `stats`. Send only what changed. |
| `activity` | "I touched the on-disk session store" — the sidebar re-lists. |

Two invariants worth internalizing:

- **Normalize hostile content.** Wire content may be a block array, a bare
  string, or missing. Never crash on shape (the Pi adapter's `normContent` is
  the pattern) — one malformed transcript must never white-screen the app.
- **Hosts inject one synthetic line**, `{type: "cwd", cwd}` — the resolved
  working directory the child spawned in. Fold it into
  `meta.identity.cwd` if your CLI doesn't report its own.

## Connect-time choreography

`onConnected({resumed, defaultThinkingLevel})` fires when the transport is up.
Fetch whatever your protocol needs to populate the UI (state, model list, the
saved transcript when `resumed`). The engine never guesses — if you don't
fetch it, it stays empty, and capability-gated chrome simply doesn't render.

## Session stores (the sidebar)

If your CLI persists sessions on disk, implement `sessions: SessionStore`
(`list`/`watch`/`delete`/`rename`) so the sidebar can list, reopen, and manage
them. See `src/lib/adapters/pi/sessions.ts`.

Honest caveat: the desktop host currently ships **Pi's** store commands
(`pi_list_sessions` + fs watcher in `src-tauri/src/pi.rs`) and the dev bridge
mirrors them over HTTP. A different CLI's store needs the equivalent host
support (a directory scan + watch); until then, omit `sessions` — the sidebar
shows open tabs only, and everything else works. (The claude-code adapter
ships this way.)

## Custom transports

`createTransport?(key)` replaces the host transport entirely — the mock
adapter uses an in-memory one that spawns nothing. Reach for this when your
backend isn't a stdio child (remote agent over WebSocket, HTTP polling, a
Web Worker). Implement the 5-method `Transport` interface
(`src/lib/agent/transport.ts`) and the engine can't tell the difference.

## Testing your adapter

Fixture-fold, no process needed — the pattern from `tests/pi-adapter.test.ts`:

```ts
const session = yourAdapter.createSession({ send: (l) => sent.push(l), emit: () => {} });
let state = initialState;
for (const line of RECORDED_WIRE_LINES)
  for (const ev of session.handleLine(line))
    if (ev.kind !== "meta" && ev.kind !== "activity") state = reduce(state, ev);
expect(state.items).toMatchObject([...]);
```

Capture `RECORDED_WIRE_LINES` by running your CLI's JSONL mode once and
saving stdout. Cover at minimum: a plain text turn, a tool-call turn, an
error, and (if applicable) hydration. Run `bun run test`.

For UI-level coverage the e2e suite (`bun run e2e`) already exercises the
whole engine loop through the mock adapter — extend it only for genuinely new
UI behavior your adapter introduces.
