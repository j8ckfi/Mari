# FRONTEND.md — Mari's design language

> **Forking Mari? Rewrite this file.**
> This document is *Mari's* taste — its radii, motion rules, and restraint.
> It exists so agents working on Mari produce UI that looks like Mari. It is
> **not** a constraint on your fork: when you fork, replace this file with
> your own design language, and agents building your fork will follow yours
> instead. Keeping it unedited means every AI-written PR will quietly look
> like Mari forever. The other docs (ARCHITECTURE, ADAPTERS) stay valid in a
> fork; this one is meant to be overwritten.

Design bet: **taste is the differentiator.** Calm blank-slate surface, motion
that means something, deep polish concentrated on the chat surface.

## Shape / radius system

- The squircle/radius system lives in `src/lib/shape-context.tsx`. No
  `ShapeProvider` is mounted, so `useShape()` falls back to `shapeMap.pill` —
  that object drives most corner radii app-wide (despite the name it's tuned
  "properly square": container 8px, items 5px).
- `--radius` (index.css, 6px) cascades to `rounded-sm/md/lg/xl` via `@theme`.
- Genuinely circular controls (send button, model/thinking pills, dots) use
  `rounded-full` directly.

## Motion (Emil Kowalski school)

- Custom easings: `--ease-out: cubic-bezier(0.23,1,0.32,1)` for
  entrances/most transitions; durations **< 300ms** for UI chrome.
- `:active` scale ~0.97 on pressables; origin-aware popovers (scale from the
  trigger, not center).
- Never: `scale(0)` entrances, `ease-in` for entrances, `transition: all`.
- Springs for physical gestures live in `src/lib/springs.ts`.
- Hidden interactive elements must also be non-interactive
  (`pointer-events-none`, `tabIndex={-1}`, `aria-hidden`) — see `JumpToLatest`
  and the title-bar new-chat button in App.tsx for the pattern.

## Status & liveness

- **NEVER use a pulsing/pinging green dot for the agent-working indicator.**
  Rejected on sight, repeatedly. Liveness is expressed with expressive assets:
  the title shimmer (`.shimmer-run`), the rose thinking pill
  (`src/components/ui/thinking-indicator.tsx`, `RoseLoader`).
- Blank slate stays blank: no border beam, no connection-status dot. The
  "disconnected" banner is the only connection affordance (it's load-bearing —
  it carries the reconnect).

## The chat surface

- **Work traces** (`ThinkingSteps`) are collapsed by default, even while
  streaming — a timeline that grows a step at a time drags the reader down.
  The header carries the live "Working…" label; expanding a trace disengages
  scroll-follow so new steps never yank the reader.
- Reasoning-only chunks stay invisible at rest; a work chunk renders only when
  it contains a real tool step (see `workHasTool` in Conversation.tsx). A
  think→answer turn reads as just the answer.
- Scroll behavior (`src/hooks/useChatScroll.ts`): new turns seat near the top
  of the viewport; a reserved spacer keeps a fresh turn's whitespace inside
  one viewport so streaming eats it rather than growing dead space; follow
  re-engages via the jump-to-latest pill.
- Time + copy affordances appear on hover once a segment settles, never
  mid-stream.

## Pickers & controls

- **Model picker** is a Base UI **Combobox** — searchable (200+ models),
  auto-focused input, opens **upward** pinned
  (`collisionAvoidance={{ side: "none" }}`) so it never flips. Grouped by
  provider.
- **Thinking picker** is a plain Base UI **Select** (few options), and is
  **model-aware** (`src/lib/agent/thinking.ts`): only the levels the model
  actually accepts, read from `thinkingLevelMap` — never hard-code the list.
  No real choice → no picker.
- Composer chrome is capability-gated: adapters that can't switch models or
  report stats simply don't get those pills (see ComposerControls.tsx).

## Icons & typography

- Icon indirection lives in `src/lib/icon-context.tsx` + `icon-map.tsx`;
  step icons are named in the icon map ("monitor", "brain", "pencil", …) and
  resolved per icon library. Adapters pick names via
  `src/lib/agent/tool-meta.ts`.
- Variable-font weight transitions (`src/lib/font-weight.ts`) instead of
  weight jumps.

## Theming

- Light/dark/system via `.dark` on the root + native `color-scheme`
  (`src/lib/settings.ts` owns application). System tracks the OS live.
- The optional macOS glass sidebar is pure CSS over an always-mounted native
  effect view, toggled by `data-glass` on `<html>` — no native round-trip.

## House rules for new UI

1. Match the file you're editing: comment density, naming, idiom.
2. Motion must mean something — enter/exit expresses hierarchy or causality,
   not decoration.
3. Empty states are designed, not left over.
4. Anything that appears/disappears needs both states designed (and the
   hidden state non-interactive).
5. When in doubt, remove chrome rather than add it.
