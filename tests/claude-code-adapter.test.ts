// Claude Code adapter translation — fixture lines captured from a real
// `claude -p --input-format stream-json --output-format stream-json` run
// (trimmed to the fields the adapter reads), plus synthesized stream_event
// deltas per the Anthropic streaming format.

import { describe, expect, test } from "bun:test";
import { claudeCodeAdapter } from "@/lib/adapters/claude-code";
import { initialState, reduce } from "@/lib/agent/reducer";
import type { AssistantItem } from "@/lib/agent/types";

function makeSession(sent: unknown[] = []) {
  return claudeCodeAdapter.createSession({
    send: (line) => sent.push(line),
    emit: () => {},
  });
}

function run(lines: unknown[]) {
  const sent: unknown[] = [];
  const session = makeSession(sent);
  let state = reduce(initialState, { kind: "run-start" }); // prompt() emits this
  const metas: unknown[] = [];
  for (const line of lines) {
    for (const ev of session.handleLine(line)) {
      if (ev.kind === "meta") metas.push(ev);
      else if (ev.kind !== "activity") state = reduce(state, ev);
    }
  }
  return { state, sent, metas, session };
}

const INIT = {
  type: "system",
  subtype: "init",
  cwd: "/Users/x/project",
  session_id: "8a3a3a3e-bf01-421f-b3d9-d46250525a34",
  model: "claude-haiku-4-5-20251001",
};

// A successful turn: streamed text deltas → complete assistant message with a
// tool_use → tool_result → final text → result.
const SUCCESS_TURN: unknown[] = [
  INIT,
  {
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
  },
  {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } },
  },
  {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "check." } },
  },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "echo hi" } },
      ],
    },
    parent_tool_use_id: null,
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "hi\n", is_error: false },
      ],
    },
    parent_tool_use_id: null,
  },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "It printed `hi`." }],
    },
    parent_tool_use_id: null,
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "It printed `hi`.",
    session_id: "8a3a3a3e-bf01-421f-b3d9-d46250525a34",
  },
];

describe("stream translation", () => {
  test("deltas stream, assistant messages finalize, tools open/close steps", () => {
    const { state } = run(SUCCESS_TURN);
    const a = state.items[0] as AssistantItem;
    expect(a.streaming).toBe(false);
    expect(a.parts.map((p) => p.kind)).toEqual(["prose", "work", "prose"]);
    expect(a.parts[0]).toMatchObject({ text: "Let me check." });
    const work = a.parts[1];
    if (work.kind !== "work") throw new Error("expected work");
    expect(work.steps[0]).toMatchObject({
      label: "Ran echo hi",
      output: "hi\n",
      status: "complete",
    });
    expect(a.parts[2]).toMatchObject({ text: "It printed `hi`." });
  });

  test("init carries identity + model meta", () => {
    const { metas } = run([INIT]);
    expect(metas[0]).toMatchObject({
      identity: { sessionId: "8a3a3a3e-bf01-421f-b3d9-d46250525a34", cwd: "/Users/x/project" },
      model: { id: "claude-haiku-4-5-20251001" },
    });
  });

  test("subagent traffic (parent_tool_use_id) is filtered out", () => {
    const session = makeSession();
    expect(
      session.handleLine({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "nested" }] },
        parent_tool_use_id: "toolu_parent",
      }),
    ).toEqual([]);
  });

  test("an error result becomes run-error + run-end", () => {
    // Verbatim shape from a real failed run (fields trimmed).
    const { state } = run([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Not logged in · Please run /login" }],
        },
        parent_tool_use_id: null,
        error: "authentication_failed",
      },
      {
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Not logged in · Please run /login",
      },
    ]);
    const a = state.items[0] as AssistantItem;
    expect(a.error).toBe("Not logged in · Please run /login");
    expect(a.streaming).toBe(false);
  });
});

describe("intents", () => {
  test("prompt sends a stream-json user message with image blocks first", () => {
    const sent: unknown[] = [];
    const session = claudeCodeAdapter.createSession({
      send: (l) => sent.push(l),
      emit: () => {},
    });
    session.prompt(
      "look at this",
      [{ type: "image", data: "AAAA", mimeType: "image/png" }],
      { streaming: false },
    );
    expect(sent[0]).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "AAAA" },
          },
          { type: "text", text: "look at this" },
        ],
      },
    });
  });

  test("abort sends an interrupt control_request", () => {
    const sent: unknown[] = [];
    const session = claudeCodeAdapter.createSession({
      send: (l) => sent.push(l),
      emit: () => {},
    });
    session.abort();
    expect(sent[0]).toMatchObject({
      type: "control_request",
      request: { subtype: "interrupt" },
    });
  });

  test("can_use_tool becomes a confirm question; answers map to allow/deny", () => {
    const sent: unknown[] = [];
    const session = makeSession(sent);
    const events = session.handleLine({
      type: "control_request",
      request_id: "req_1",
      request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -rf /" } },
    });
    expect(events[0]).toMatchObject({
      kind: "question",
      question: { method: "confirm", title: "Allow Bash?" },
    });
    const qid = (events[0] as { question: { id: string } }).question.id;

    session.respond?.(qid, { confirmed: false });
    expect(sent[0]).toMatchObject({
      type: "control_response",
      response: {
        request_id: "req_1",
        response: { behavior: "deny" },
      },
    });
  });
});

describe("spawn", () => {
  test("builds the stream-json command; Pi-style model ids are not forwarded", () => {
    const spec = claudeCodeAdapter.spawn({
      cwd: "/w",
      model: "openai-codex/gpt-5.5", // Pi format — must be skipped
    });
    expect(spec.bin).toBe("claude");
    expect(spec.args).not.toContain("--model");
    expect(spec.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ]),
    );

    const withModel = claudeCodeAdapter.spawn({ model: "claude-haiku-4-5-20251001" });
    expect(withModel.args).toContain("--model");
  });
});
