// The mock adapter — a scripted fake backend with ZERO external dependencies.
//
// Three jobs:
//   1. The copy-paste TEMPLATE for new adapters (this is the smallest complete
//      AgentAdapter; the contract lives in src/lib/agent/types.ts, the guide
//      in docs/ADAPTERS.md).
//   2. A live demo: `VITE_AGENT=mock bun run dev` gives a fully working chat
//      with no CLI, no credentials, no bridge — first-clone experience.
//   3. The deterministic backend the e2e tests drive.
//
// It spawns nothing: `createTransport` returns an in-memory transport that
// "connects" instantly, and `prompt` plays a scripted stream of AgentEvents
// through ctx.emit. A real adapter would instead return wire commands from its
// action methods and translate stdout lines in handleLine — see
// src/lib/adapters/pi/ for the full-featured version.

import type {
  AdapterSession,
  AdapterSessionContext,
  AgentAdapter,
  AgentEvent,
} from "@/lib/agent/types";
import type { ConnState, Transport } from "@/lib/agent/transport";

// ── In-memory transport: no process, connects instantly ──────────────────────
function createMockTransport(): Transport {
  const stateCbs = new Set<(s: ConnState) => void>();
  return {
    async start() {
      stateCbs.forEach((cb) => cb("connecting"));
      // Yield once so the engine has subscribed before "connected" lands.
      setTimeout(() => stateCbs.forEach((cb) => cb("connected")), 10);
    },
    async stop() {},
    async send() {},
    onLine() {
      return () => {};
    },
    onState(cb) {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
  };
}

// ── The scripted response ─────────────────────────────────────────────────────
// Each entry: [delay-ms-after-previous, events]. Text/thinking snapshots are
// CUMULATIVE (see the AgentEvent contract).
function script(prompt: string): Array<[number, AgentEvent[]]> {
  const think = "Let me look at that request…";
  const answer =
    `You said: **${prompt}**\n\n` +
    "This reply came from the mock adapter (`src/lib/adapters/mock/`) — " +
    "no agent CLI was involved. Swap the adapter in `src/config.ts` to " +
    "drive a real one.";
  const steps: Array<[number, AgentEvent[]]> = [
    [0, [{ kind: "run-start" }]],
    [150, [{ kind: "thinking", thinking: think.slice(0, 12) }]],
    [150, [{ kind: "thinking", thinking: think, final: true }]],
    [
      100,
      [
        {
          kind: "step-start",
          id: "mock-tool-1",
          icon: "monitor",
          label: "Ran echo hello-from-mock",
        },
      ],
    ],
    [
      300,
      [
        {
          kind: "step-end",
          id: "mock-tool-1",
          output: "hello-from-mock",
          isError: false,
        },
      ],
    ],
    // Stream the answer in three cumulative snapshots.
    [150, [{ kind: "text", text: answer.slice(0, 30) }]],
    [150, [{ kind: "text", text: answer.slice(0, 90) }]],
    [150, [{ kind: "text", text: answer, final: true }]],
    [50, [{ kind: "run-end" }]],
  ];
  // Saying "interleave" demos a long agentic turn: narration → tool → narration
  // → tool → answer, i.e. multiple prose segments split by work chunks.
  if (/\binterleave\b/i.test(prompt)) {
    const n1 = "I'll search the docs for that first.";
    const n2 =
      "The search needs auth which isn't set up — let me check the local config instead.";
    return [
      [0, [{ kind: "run-start" }]],
      [150, [{ kind: "text", text: n1, final: true }]],
      [
        100,
        [
          {
            kind: "step-start",
            id: "mock-tool-a",
            icon: "monitor",
            label: "Searched docs",
          },
        ],
      ],
      [300, [{ kind: "step-end", id: "mock-tool-a", output: "auth required" }]],
      [150, [{ kind: "text", text: n2, final: true }]],
      [
        100,
        [
          {
            kind: "step-start",
            id: "mock-tool-b",
            icon: "monitor",
            label: "Read local config",
          },
        ],
      ],
      [300, [{ kind: "step-end", id: "mock-tool-b", output: "{ model: 'gpt-5.5' }" }]],
      [
        150,
        [
          {
            kind: "text",
            text:
              answer +
              "\n\n```ts\n// the config that was read\nexport const model = 'gpt-5.5'\n```",
            final: true,
          },
        ],
      ],
      [50, [{ kind: "run-end" }]],
    ];
  }
  // Saying "ask me" demos the question flow before the run continues.
  if (/\bask me\b/i.test(prompt)) {
    steps.splice(1, 0, [
      100,
      [
        {
          kind: "question",
          question: {
            id: "mock-q-1",
            method: "select",
            title: "Mock question: pick an option",
            options: ["Option A", "Option B"],
          },
        },
      ],
    ]);
  }
  return steps;
}

function createSession(ctx: AdapterSessionContext): AdapterSession {
  let timers: ReturnType<typeof setTimeout>[] = [];

  const cancel = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  return {
    // No wire, so nothing ever arrives here.
    handleLine() {
      return [];
    },

    onConnected() {
      ctx.emit([
        { kind: "meta", identity: { sessionName: undefined, cwd: "~" } },
      ]);
    },

    prompt(text) {
      cancel();
      let at = 0;
      for (const [delay, events] of script(text)) {
        at += delay;
        timers.push(setTimeout(() => ctx.emit(events), at));
      }
    },

    abort() {
      cancel();
      ctx.emit([{ kind: "run-end" }]);
    },

    respond(id) {
      // A real adapter forwards the answer over the wire; the engine already
      // removed the question item.
      void id;
    },
  };
}

export const mockAdapter: AgentAdapter = {
  id: "mock",
  name: "Mock",
  capabilities: {
    models: false,
    thinkingLevels: false,
    steer: false,
    questions: true,
    fork: false,
    rename: false,
    stats: false,
    attachments: false,
  },
  // Never spawned (the in-memory transport ignores it), but the contract
  // requires a spec — a real adapter builds its CLI command here.
  spawn: (opts) => ({ bin: "true", args: [], cwd: opts.cwd }),
  createSession,
  createTransport: createMockTransport,
};
