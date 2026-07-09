// Pi adapter translation — folds a recorded `pi --mode rpc` event stream
// through handleLine + the core reducer and asserts the rendered transcript.
// The fixture lines mirror the wire shapes in src/lib/adapters/pi/protocol.ts;
// if Pi's protocol drifts, this is the test that should catch it.

import { describe, expect, test } from "bun:test";
import { piAdapter, buildItemsFromMessages } from "@/lib/adapters/pi";
import { initialState, reduce } from "@/lib/agent/reducer";
import type { AgentEvent, AssistantItem } from "@/lib/agent/types";

function makeSession(sent: unknown[] = []) {
  return piAdapter.createSession({
    send: (line) => sent.push(line),
    emit: () => {},
  });
}

/** Fold raw wire lines through the adapter into a view state. */
function run(lines: unknown[]) {
  const sent: unknown[] = [];
  const session = makeSession(sent);
  let state = initialState;
  const all: AgentEvent[] = [];
  for (const line of lines) {
    for (const ev of session.handleLine(line)) {
      all.push(ev);
      if (ev.kind !== "meta" && ev.kind !== "activity") state = reduce(state, ev);
    }
  }
  return { state, sent, events: all };
}

// A condensed real-world turn: prompt → thinking → tool call → answer.
const LIVE_TURN: unknown[] = [
  { type: "agent_start" },
  { type: "turn_start" },
  { type: "message_start", message: { role: "assistant", content: [] } },
  {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Need to run echo" }],
    },
    assistantMessageEvent: { type: "thinking_delta" },
  },
  {
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Need to run echo" },
        { type: "toolCall", id: "call1", name: "bash", arguments: { command: "echo hi" } },
      ],
      stopReason: "toolUse",
    },
  },
  {
    type: "tool_execution_start",
    toolCallId: "call1",
    toolName: "bash",
    args: { command: "echo hi" },
  },
  {
    type: "tool_execution_end",
    toolCallId: "call1",
    toolName: "bash",
    result: { content: [{ type: "text", text: "hi\n" }] },
    isError: false,
  },
  { type: "message_start", message: { role: "assistant", content: [] } },
  {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "It printed" }] },
    assistantMessageEvent: { type: "text_delta" },
  },
  {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "It printed `hi`." }],
      stopReason: "stop",
    },
  },
  { type: "turn_end" },
  { type: "agent_end" },
];

describe("live stream translation", () => {
  test("thinking → tool → answer becomes work + prose in order", () => {
    const { state } = run(LIVE_TURN);
    const a = state.items[0] as AssistantItem;
    expect(a.type).toBe("assistant");
    expect(a.streaming).toBe(false);
    expect(a.parts.map((p) => p.kind)).toEqual(["work", "prose"]);

    const work = a.parts[0];
    if (work.kind !== "work") throw new Error("expected work");
    expect(work.steps.map((s) => s.kind)).toEqual(["thinking", "tool"]);
    expect(work.steps[1]).toMatchObject({
      label: "Ran echo hi",
      output: "hi\n",
      status: "complete",
    });

    const prose = a.parts[1];
    if (prose.kind !== "prose") throw new Error("expected prose");
    expect(prose.text).toBe("It printed `hi`.");
    expect(prose.streaming).toBe(false);
  });

  test("string message content doesn't crash (normContent invariant)", () => {
    const { state } = run([
      { type: "agent_start" },
      {
        type: "message_update",
        message: { role: "assistant", content: "bare string content" },
        assistantMessageEvent: { type: "text_delta" },
      },
      { type: "agent_end" },
    ]);
    const a = state.items[0] as AssistantItem;
    expect(a.parts[0]).toMatchObject({ kind: "prose", text: "bare string content" });
  });

  test("agent lifecycle triggers state refresh commands", () => {
    const { sent } = run([{ type: "agent_start" }, { type: "agent_end" }]);
    const types = sent.map((c) => (c as { type: string }).type);
    expect(types).toContain("get_state");
    expect(types).toContain("get_session_stats");
  });

  test("errors surface as run-error", () => {
    const { state } = run([
      { type: "agent_start" },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "rate limited",
        },
      },
      { type: "agent_end" },
    ]);
    expect((state.items[0] as AssistantItem).error).toBe("rate limited");
  });

  test("extension UI select becomes a question; response goes over the wire", () => {
    const sent: unknown[] = [];
    const session = makeSession(sent);
    const events = session.handleLine({
      type: "extension_ui_request",
      id: "q9",
      method: "select",
      title: "Pick one",
      options: ["a", "b"],
    });
    expect(events[0]).toMatchObject({
      kind: "question",
      question: { id: "q9", method: "select", options: ["a", "b"] },
    });
    session.respond?.("q9", { value: "b" });
    expect(sent[0]).toMatchObject({
      type: "extension_ui_response",
      id: "q9",
      value: "b",
    });
  });

  test("compaction opens and clears a sticky notice", () => {
    const { state } = run([
      { type: "compaction_start", reason: "threshold" },
    ]);
    expect(state.items[0]).toMatchObject({ type: "notice", variant: "compaction" });
    const { state: cleared } = run([
      { type: "compaction_start", reason: "threshold" },
      { type: "compaction_end", reason: "threshold", result: {}, aborted: false },
    ]);
    expect(cleared.items).toHaveLength(0);
  });
});

describe("responses → meta", () => {
  test("get_state maps model/thinking/identity; cwd only when present", () => {
    const session = makeSession();
    const events = session.handleLine({
      type: "response",
      command: "get_state",
      success: true,
      data: {
        model: { id: "m1", name: "M1", api: "x", provider: "p" },
        thinkingLevel: "high",
        sessionFile: "/tmp/s.jsonl",
        sessionId: "abc",
      },
    });
    expect(events[0]).toMatchObject({
      kind: "meta",
      model: { id: "m1" },
      thinkingLevel: "high",
      identity: { sessionFile: "/tmp/s.jsonl", sessionId: "abc" },
    });
    expect(
      (events[0] as { identity?: Record<string, unknown> }).identity,
    ).not.toHaveProperty("cwd");
  });

  test("get_messages hydrates via the transcript builder", () => {
    const session = makeSession();
    const events = session.handleLine({
      type: "response",
      command: "get_messages",
      success: true,
      data: {
        messages: [
          { role: "user", content: "hi", timestamp: 1 },
          {
            role: "assistant",
            content: [{ type: "text", text: "hello!" }],
            timestamp: 2,
          },
        ],
      },
    });
    expect(events[0].kind).toBe("hydrate");
    const items = (events[0] as { items: unknown[] }).items;
    expect(items).toHaveLength(2);
  });

  test("failed responses emit nothing", () => {
    const session = makeSession();
    expect(
      session.handleLine({
        type: "response",
        command: "get_state",
        success: false,
        error: "nope",
      }),
    ).toEqual([]);
  });
});

describe("hydration edge cases", () => {
  test("tool results patch their steps; interleaved prose survives", () => {
    const items = buildItemsFromMessages([
      { role: "user", content: "go", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking." },
          { type: "toolCall", id: "c1", name: "read", arguments: { path: "/a/b.ts" } },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "file body" }],
        isError: false,
        timestamp: 3,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "All good." }],
        timestamp: 4,
      },
    ]);
    const a = items[1] as AssistantItem;
    expect(a.parts.map((p) => p.kind)).toEqual(["prose", "work", "prose"]);
    const work = a.parts[1];
    if (work.kind !== "work") throw new Error("expected work");
    expect(work.steps[0]).toMatchObject({
      label: "Read b.ts",
      output: "file body",
    });
  });

  test("malformed roles and empty shells don't crash or render", () => {
    const items = buildItemsFromMessages([
      { role: "weird", content: 42 },
      { role: "user", content: [{ type: "text", text: "" }] },
      { role: "toolResult", toolCallId: "orphan", toolName: "x", content: [] },
    ] as never);
    expect(items).toEqual([]);
  });
});

describe("spawn", () => {
  test("builds the pi RPC command from options", () => {
    expect(
      piAdapter.spawn({
        cwd: "/w",
        model: "prov/model-x",
        sessionPath: "/s.jsonl",
        name: "My chat",
        pathDirs: ["/extra"],
      }),
    ).toEqual({
      bin: "pi",
      args: [
        "--mode",
        "rpc",
        "--model",
        "prov/model-x",
        "--name",
        "My chat",
        "--session",
        "/s.jsonl",
      ],
      cwd: "/w",
      pathDirs: ["/extra"],
    });
  });
});
