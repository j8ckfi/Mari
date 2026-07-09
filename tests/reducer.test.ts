// Core reducer behaviors — the streaming bookkeeping every adapter relies on.
// If these break, every backend's transcript breaks: run `bun test`.

import { describe, expect, test } from "bun:test";
import {
  initialState,
  reduce,
  TranscriptBuilder,
  type ReducerInput,
  type SessionViewState,
} from "@/lib/agent/reducer";
import type { AssistantItem } from "@/lib/agent/types";

function fold(events: ReducerInput[], from = initialState): SessionViewState {
  return events.reduce(reduce, from);
}

function assistant(state: SessionViewState, index = 0): AssistantItem {
  const items = state.items.filter((i) => i.type === "assistant");
  const item = items[index];
  if (!item) throw new Error(`no assistant item at ${index}`);
  return item;
}

describe("run lifecycle", () => {
  test("run-start opens a streaming assistant item; run-end settles it", () => {
    let s = fold([{ kind: "run-start" }]);
    expect(s.streaming).toBe(true);
    expect(assistant(s).streaming).toBe(true);

    s = fold([{ kind: "run-end" }], s);
    expect(s.streaming).toBe(false);
    expect(assistant(s).streaming).toBe(false);
    expect(assistant(s).endedAt).toBeNumber();
  });

  test("a step/text arriving before run-start still creates the item", () => {
    const s = fold([{ kind: "text", text: "hello" }]);
    const a = assistant(s);
    expect(a.parts).toEqual([
      { kind: "prose", id: expect.any(String), text: "hello", streaming: true },
    ]);
  });

  test("run-end completes steps left active", () => {
    const s = fold([
      { kind: "run-start" },
      { kind: "step-start", id: "t1", icon: "monitor", label: "Ran x" },
      { kind: "run-end" },
    ]);
    const part = assistant(s).parts[0];
    if (part.kind !== "work") throw new Error("expected work part");
    expect(part.steps[0].status).toBe("complete");
    expect(part.endedAt).toBeNumber();
  });
});

describe("cumulative snapshots", () => {
  test("text snapshots update ONE prose part (idempotent re-delivery)", () => {
    const s = fold([
      { kind: "run-start" },
      { kind: "text", text: "Hel" },
      { kind: "text", text: "Hello" },
      { kind: "text", text: "Hello" }, // duplicate delivery
      { kind: "text", text: "Hello world", final: true },
    ]);
    const a = assistant(s);
    expect(a.parts).toHaveLength(1);
    expect(a.parts[0]).toMatchObject({
      kind: "prose",
      text: "Hello world",
      streaming: false,
    });
  });

  test("thinking streams into one step and settles on final", () => {
    const s = fold([
      { kind: "run-start" },
      { kind: "thinking", thinking: "Let me" },
      { kind: "thinking", thinking: "Let me think", final: true },
    ]);
    const part = assistant(s).parts[0];
    if (part.kind !== "work") throw new Error("expected work part");
    expect(part.steps).toHaveLength(1);
    expect(part.steps[0]).toMatchObject({
      kind: "thinking",
      output: "Let me think",
      status: "complete",
    });
  });

  test("segment-break starts a fresh prose part for the next snapshot", () => {
    const s = fold([
      { kind: "run-start" },
      { kind: "text", text: "first", final: true },
      { kind: "segment-break" },
      { kind: "text", text: "second" },
    ]);
    const a = assistant(s);
    expect(a.parts.map((p) => (p.kind === "prose" ? p.text : p.kind))).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("part interleaving", () => {
  test("prose → tool → prose keeps document order; steps group into one chunk", () => {
    const s = fold([
      { kind: "run-start" },
      { kind: "text", text: "Looking…", final: true },
      { kind: "step-start", id: "a", icon: "monitor", label: "Ran ls" },
      { kind: "step-end", id: "a", output: "ok" },
      { kind: "step-start", id: "b", icon: "search", label: "Searched" },
      { kind: "step-end", id: "b" },
      { kind: "text", text: "Done." },
      { kind: "run-end" },
    ]);
    const parts = assistant(s).parts;
    expect(parts.map((p) => p.kind)).toEqual(["prose", "work", "prose"]);
    const work = parts[1];
    if (work.kind !== "work") throw new Error("expected work");
    expect(work.steps.map((st) => st.id)).toEqual(["a", "b"]);
    expect(work.steps.map((st) => st.status)).toEqual(["complete", "complete"]);
  });

  test("a step closes the open prose so later text starts a new bubble", () => {
    const s = fold([
      { kind: "run-start" },
      { kind: "text", text: "before" }, // still streaming, not final
      { kind: "step-start", id: "a", icon: "dot", label: "tool" },
      { kind: "text", text: "after" },
    ]);
    const parts = assistant(s).parts;
    expect(parts.map((p) => (p.kind === "prose" ? p.text : "work"))).toEqual([
      "before",
      "work",
      "after",
    ]);
  });

  test("step-update / step-end patch the step wherever it lives", () => {
    const s = fold([
      { kind: "run-start" },
      { kind: "step-start", id: "a", icon: "dot", label: "tool" },
      { kind: "text", text: "middle", final: true },
      { kind: "step-update", id: "a", output: "partial" },
      { kind: "step-end", id: "a", output: "full", isError: true },
    ]);
    const work = assistant(s).parts[0];
    if (work.kind !== "work") throw new Error("expected work");
    expect(work.steps[0]).toMatchObject({ output: "full", status: "error" });
  });
});

describe("questions and notices", () => {
  test("question renders and @resolveQuestion removes it", () => {
    let s = fold([
      {
        kind: "question",
        question: { id: "q1", method: "confirm", title: "Sure?" },
      },
    ]);
    expect(s.items.some((i) => i.type === "question")).toBe(true);
    s = fold([{ type: "@resolveQuestion", id: "q1" }], s);
    expect(s.items.some((i) => i.type === "question")).toBe(false);
  });

  test("sticky notices replace themselves and clear", () => {
    let s = fold([
      { kind: "notice", sticky: "compaction", variant: "compaction", text: "Compacting…" },
      { kind: "notice", sticky: "compaction", variant: "compaction", text: "Still compacting…" },
    ]);
    const notices = s.items.filter((i) => i.type === "notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ text: "Still compacting…" });
    s = fold([{ kind: "notice-clear", sticky: "compaction" }], s);
    expect(s.items).toHaveLength(0);
  });

  test("run-error lands on the assistant item", () => {
    const s = fold([
      { kind: "run-start" },
      { kind: "run-error", message: "boom" },
      { kind: "run-end" },
    ]);
    expect(assistant(s).error).toBe("boom");
  });
});

describe("TranscriptBuilder (hydration)", () => {
  test("routes blocks in document order, matching the live fold", () => {
    const items = new TranscriptBuilder()
      .user("do the thing", 1000)
      .thinking("hmm", 2000)
      .step("t1", "monitor", "Ran x", 2500)
      .stepResult("t1", "output!", false, 3000)
      .prose("done", 4000)
      .items();
    expect(items.map((i) => i.type)).toEqual(["user", "assistant"]);
    const a = items[1] as AssistantItem;
    expect(a.parts.map((p) => p.kind)).toEqual(["work", "prose"]);
    const work = a.parts[0];
    if (work.kind !== "work") throw new Error("expected work");
    expect(work.steps.map((st) => st.kind)).toEqual(["thinking", "tool"]);
    expect(work.steps[1].output).toBe("output!");
    expect(a.startedAt).toBe(2000);
    expect(a.endedAt).toBe(4000);
  });

  test("empty user turns are skipped; a user turn closes the run", () => {
    const items = new TranscriptBuilder()
      .user("first")
      .prose("answer one")
      .user("   ")
      .user("second")
      .prose("answer two")
      .items();
    expect(items.map((i) => i.type)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });
});
