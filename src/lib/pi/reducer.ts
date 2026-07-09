// Folds the Pi event stream into a renderable conversation.
//
// Rendering model: an assistant run is an ORDERED list of `parts`. Each part is
// either `prose` (a rendered markdown segment) or `work` (a chunk of the
// thinking/tool timeline). Prose is first-class and positional — text that
// appears between two tool calls stays between them, and text that shares a
// message with a tool call is NOT swallowed. Interleaving (prose → work →
// prose → work) falls out for free; the "answer" is simply the trailing prose.
//
// This replaced an older `steps[] + answer` model whose single `answer` slot
// could hold only the last tool-free message, so a terminal tool call (e.g.
// goal_complete) or interleaved narration silently dropped real output.

import type {
  AgentMessage,
  AssistantContent,
  AssistantMessage,
  ExtensionUiRequest,
  PiEvent,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from "./types";

// ── View model ──────────────────────────────────────────────────────────────
export type StepKind = "tool" | "thinking";
export type StepStatus = "active" | "complete" | "error";

export interface Step {
  id: string;
  kind: StepKind;
  /** Fluid icon-map name. */
  icon: string;
  label: string;
  /** Collapsible detail: tool output, or the reasoning text. */
  output?: string;
  status: StepStatus;
}

/** A rendered markdown segment of an assistant run. */
export interface ProsePart {
  kind: "prose";
  id: string;
  text: string;
  streaming: boolean;
}
/** A contiguous chunk of the thinking/tool timeline between two prose segments. */
export interface WorkPart {
  kind: "work";
  id: string;
  steps: Step[];
  /** Wall-clock span of this chunk → its own "Worked for Xs" header. */
  startedAt?: number;
  endedAt?: number;
}
export type RunPart = ProsePart | WorkPart;

export interface AssistantItem {
  type: "assistant";
  id: string;
  parts: RunPart[];
  streaming: boolean;
  error?: string;
  /** Wall-clock run timing (live turns only) → per-prose settled timestamp. */
  startedAt?: number;
  endedAt?: number;
}
export interface UserItem {
  type: "user";
  id: string;
  text: string;
  images?: number;
  /** When the message was sent (epoch ms) — the hover "time sent" label. */
  createdAt?: number;
}
export interface QuestionItem {
  type: "question";
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}
export interface NoticeItem {
  type: "notice";
  id: string;
  variant: "info" | "warning" | "error" | "compaction" | "retry";
  text: string;
}

export type ChatItem = UserItem | AssistantItem | QuestionItem | NoticeItem;

export interface SessionState {
  items: ChatItem[];
  streaming: boolean;
  currentAssistantId: string | null;
  /** The thinking step being streamed into for the current message, if any. */
  currentThinkingStepId: string | null;
  /** The prose part being streamed into for the current message, if any. */
  currentProseId: string | null;
  queue: { steering: string[]; followUp: string[] };
  seq: number;
}

export const initialState: SessionState = {
  items: [],
  streaming: false,
  currentAssistantId: null,
  currentThinkingStepId: null,
  currentProseId: null,
  queue: { steering: [], followUp: [] },
  seq: 0,
};

export type LocalAction =
  | { type: "@user"; text: string; images?: number }
  | { type: "@reset" }
  | { type: "@resolveQuestion"; id: string }
  | { type: "@hydrate"; messages: AgentMessage[] };

export type ReducerInput = PiEvent | LocalAction;

// ── content helpers ──────────────────────────────────────────────────────
// Message content may arrive as an array of blocks, a bare string (older/other
// tools, hand-written session files), or be missing entirely. Normalize to a
// block array so nothing downstream crashes on an unexpectedly-shaped session
// file — durability: one malformed file must never white-screen the app.
function normContent(content: unknown): AssistantContent[] {
  if (Array.isArray(content)) return content as AssistantContent[];
  if (typeof content === "string")
    return content ? [{ type: "text", text: content } as AssistantContent] : [];
  return [];
}
function extractText(content: unknown): string {
  return normContent(content)
    .filter((c): c is Extract<AssistantContent, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
}
function extractThinking(content: unknown): string {
  return normContent(content)
    .filter(
      (c): c is Extract<AssistantContent, { type: "thinking" }> =>
        c.type === "thinking",
    )
    .map((c) => c.thinking)
    .join("");
}
function textFromResult(result: ToolResult | undefined): string {
  if (!result?.content) return "";
  return result.content
    .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
    .join("");
}

function basename(p: unknown): string {
  if (typeof p !== "string") return "";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
function short(s: unknown, n = 48): string {
  if (typeof s !== "string") return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

/** Human label + Fluid icon for a tool call. */
function toolStepMeta(name: string, args: unknown): { icon: string; label: string } {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case "bash":
      return { icon: "monitor", label: `Ran ${short(a.command, 40)}` };
    case "read":
      return { icon: "square-library", label: `Read ${basename(a.file_path ?? a.path)}` };
    case "edit":
      return { icon: "pencil", label: `Edited ${basename(a.file_path ?? a.path)}` };
    case "write":
      return { icon: "pencil", label: `Wrote ${basename(a.file_path ?? a.path)}` };
    case "grep":
      return { icon: "search", label: `Searched for ${short(a.pattern, 32)}` };
    case "find":
      return { icon: "search", label: `Found files ${short(a.pattern ?? a.query, 28)}` };
    case "ls":
      return { icon: "square-library", label: `Listed ${basename(a.path) || "directory"}` };
    default:
      return { icon: "dot", label: `Used ${name}` };
  }
}

// ── parts helpers ──────────────────────────────────────────────────────────
function upsertStep(steps: Step[], step: Step): Step[] {
  const i = steps.findIndex((s) => s.id === step.id);
  if (i === -1) return [...steps, step];
  const next = [...steps];
  next[i] = { ...next[i], ...step };
  return next;
}
function patchStep(steps: Step[], id: string, patch: Partial<Step>): Step[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
}
function replaceLast(parts: RunPart[], part: RunPart): RunPart[] {
  return [...parts.slice(0, -1), part];
}

/** Add/update a work step in the trailing work part, opening a fresh one (and
 *  closing nothing) if the trailing part is prose or the run is empty. */
function stepIntoWork(
  parts: RunPart[],
  step: Step,
  workId: string,
  now: number,
): RunPart[] {
  const last = parts[parts.length - 1];
  if (last?.kind === "work")
    return replaceLast(parts, { ...last, steps: upsertStep(last.steps, step) });
  return [...parts, { kind: "work", id: workId, steps: [step], startedAt: now }];
}

/** Patch a step wherever it lives, and settle its work chunk's timer while
 *  the tool is still updating (endedAt tracks the latest activity). */
function patchWorkStep(
  parts: RunPart[],
  id: string,
  patch: Partial<Step>,
): RunPart[] {
  return parts.map((p) =>
    p.kind === "work" && p.steps.some((s) => s.id === id)
      ? { ...p, steps: patchStep(p.steps, id, patch) }
      : p,
  );
}

/** Create or update the trailing prose part. Creating one closes an open
 *  trailing work chunk (stamps its endedAt) so its timer settles. */
function writeProse(
  parts: RunPart[],
  proseId: string,
  text: string,
  streaming: boolean,
  now: number,
): RunPart[] {
  const last = parts[parts.length - 1];
  if (last?.kind === "prose" && last.id === proseId)
    return replaceLast(parts, { ...last, text, streaming });
  const base =
    last?.kind === "work" && last.endedAt == null
      ? replaceLast(parts, { ...last, endedAt: now })
      : parts;
  return [...base, { kind: "prose", id: proseId, text, streaming }];
}

// ── assistant-item mutation helper ─────────────────────────────────────────
function updateAssistant(
  state: SessionState,
  fn: (a: AssistantItem) => AssistantItem,
): SessionState {
  if (!state.currentAssistantId) return state;
  return {
    ...state,
    items: state.items.map((it) =>
      it.id === state.currentAssistantId && it.type === "assistant"
        ? fn(it)
        : it,
    ),
  };
}

/** Ensure an assistant run item exists (agent_start normally creates it, but be
 *  defensive if a tool/message arrives first). Returns [state, assistantId]. */
function ensureAssistant(state: SessionState): [SessionState, string] {
  if (state.currentAssistantId) return [state, state.currentAssistantId];
  const id = `a${state.seq}`;
  return [
    {
      ...state,
      seq: state.seq + 1,
      currentAssistantId: id,
      items: [
        ...state.items,
        {
          type: "assistant",
          id,
          parts: [],
          streaming: true,
          startedAt: Date.now(),
        },
      ],
    },
    id,
  ];
}

// ── hydration ──────────────────────────────────────────────────────────────
// Rebuild the conversation from a persisted `get_messages` dump (used when
// switching to a saved session). A flat AgentMessage[] becomes the same
// user/assistant-run item model the live reducer produces: consecutive
// assistant + toolResult messages between two user turns collapse into ONE
// AssistantItem whose blocks route to ordered prose/work parts, identically to
// the live path so a reload is pixel-identical.
function userText(msg: UserMessage): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("");
}

export function buildItemsFromMessages(messages: AgentMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let current: AssistantItem | null = null;
  let n = 0;
  let seq = 0;

  const flush = () => {
    if (current) items.push(current);
    current = null;
  };

  for (const msg of messages) {
    const role = (msg as { role?: string }).role;

    if (role === "user") {
      flush();
      const text = userText(msg as UserMessage);
      if (text.trim())
        items.push({
          type: "user",
          id: `u${n++}`,
          text,
          createdAt: (msg as UserMessage).timestamp,
        });
      continue;
    }

    if (role === "assistant") {
      if (!current)
        current = { type: "assistant", id: `a${n++}`, parts: [], streaming: false };
      const a = current;
      // Timestamps span the run: earliest starts it, latest ends it. They also
      // stamp per-chunk work timing (approximate — message granularity).
      const ts = (msg as AssistantMessage).timestamp;
      if (ts != null) {
        a.startedAt = a.startedAt ?? ts;
        a.endedAt = ts;
      }
      const now = ts ?? a.endedAt ?? 0;
      if ((msg as AssistantMessage).stopReason === "error")
        a.error = (msg as AssistantMessage).errorMessage ?? "The model returned an error.";
      // Route each block in document order so prose ↔ tool ordering survives.
      for (const block of normContent((msg as AssistantMessage).content)) {
        if (block.type === "thinking" && block.thinking.trim()) {
          a.parts = stepIntoWork(
            a.parts,
            {
              id: `t${seq++}`,
              kind: "thinking",
              icon: "brain",
              label: "Thinking",
              output: block.thinking,
              status: "complete",
            },
            `w${seq++}`,
            now,
          );
          stampTrailingWork(a.parts, now);
        } else if (block.type === "toolCall") {
          const meta = toolStepMeta(block.name, block.arguments);
          a.parts = stepIntoWork(
            a.parts,
            {
              id: block.id,
              kind: "tool",
              icon: meta.icon,
              label: meta.label,
              status: "complete",
            },
            `w${seq++}`,
            now,
          );
          stampTrailingWork(a.parts, now);
        } else if (block.type === "text" && block.text.trim()) {
          a.parts = writeProse(a.parts, `p${seq++}`, block.text, false, now);
        }
      }
      continue;
    }

    if (role === "toolResult" && current) {
      const tr = msg as ToolResultMessage;
      const output =
        tr.content?.map((c) => c.text ?? "").join("") || undefined;
      current.parts = current.parts.map((p) =>
        p.kind === "work" && p.steps.some((s) => s.id === tr.toolCallId)
          ? {
              ...p,
              endedAt: tr.timestamp ?? p.endedAt,
              steps: patchStep(p.steps, tr.toolCallId, {
                status: tr.isError ? "error" : "complete",
                output: output ?? p.steps.find((s) => s.id === tr.toolCallId)?.output,
              }),
            }
          : p,
      );
    }
  }

  flush();
  return items;
}

/** Stamp the trailing work chunk's endedAt in place (hydration timing). */
function stampTrailingWork(parts: RunPart[], now: number): void {
  const last = parts[parts.length - 1];
  if (last?.kind === "work") last.endedAt = now;
}

// ── reducer ──────────────────────────────────────────────────────────────
export function reduce(state: SessionState, ev: ReducerInput): SessionState {
  switch (ev.type) {
    case "@reset":
      return { ...initialState };

    case "@hydrate": {
      const items = buildItemsFromMessages(ev.messages);
      return {
        ...initialState,
        items,
        seq: items.length + 1,
      };
    }

    case "@user":
      return {
        ...state,
        seq: state.seq + 1,
        currentAssistantId: null,
        currentThinkingStepId: null,
        currentProseId: null,
        items: [
          ...state.items,
          {
            type: "user",
            id: `u${state.seq}`,
            text: ev.text,
            images: ev.images,
            createdAt: Date.now(),
          },
        ],
      };

    case "@resolveQuestion":
      return { ...state, items: state.items.filter((it) => it.id !== ev.id) };

    case "agent_start": {
      const id = `a${state.seq}`;
      return {
        ...state,
        seq: state.seq + 1,
        streaming: true,
        currentAssistantId: id,
        currentThinkingStepId: null,
        currentProseId: null,
        items: [
          ...state.items,
          {
            type: "assistant",
            id,
            parts: [],
            streaming: true,
            startedAt: Date.now(),
          },
        ],
      };
    }

    case "agent_end": {
      const now = Date.now();
      const s = updateAssistant(state, (a) => ({
        ...a,
        streaming: false,
        endedAt: now,
        parts: a.parts.map((p) =>
          p.kind === "work"
            ? {
                ...p,
                endedAt: p.endedAt ?? now,
                steps: p.steps.map((st) =>
                  st.status === "active" ? { ...st, status: "complete" } : st,
                ),
              }
            : { ...p, streaming: false },
        ),
      }));
      return {
        ...s,
        streaming: false,
        currentThinkingStepId: null,
        currentProseId: null,
      };
    }

    case "message_start": {
      const msg = ev.message as { role?: string };
      if (msg.role !== "assistant") return state;
      // New message in the run → fresh thinking step / prose segment next time.
      return { ...state, currentThinkingStepId: null, currentProseId: null };
    }

    case "message_update": {
      const content = ev.message?.content ?? [];
      const text = extractText(content);
      const thinking = extractThinking(content);
      let [next, id] = ensureAssistant(state);
      let thinkId = next.currentThinkingStepId;
      let proseId = next.currentProseId;
      let seq = next.seq;
      const now = Date.now();

      next = updateAssistant({ ...next, currentAssistantId: id }, (a) => {
        let parts = a.parts;
        if (thinking) {
          if (!thinkId) {
            thinkId = `t${seq++}`;
            parts = stepIntoWork(
              parts,
              {
                id: thinkId,
                kind: "thinking",
                icon: "brain",
                label: "Thinking",
                output: thinking,
                status: "active",
              },
              `w${seq++}`,
              now,
            );
          } else {
            parts = patchWorkStep(parts, thinkId, { output: thinking });
          }
        }
        // Stream text straight into a positional prose part — never demoted, so
        // no flicker/yank when a tool call follows in the same message.
        if (text) {
          if (!proseId) proseId = `p${seq++}`;
          parts = writeProse(parts, proseId, text, true, now);
        }
        return { ...a, parts };
      });

      return {
        ...next,
        seq,
        currentThinkingStepId: thinkId,
        currentProseId: proseId,
      };
    }

    case "message_end": {
      const msg = ev.message as {
        role?: string;
        content?: AssistantContent[];
        stopReason?: string;
        errorMessage?: string;
      };
      if (msg.role !== "assistant") return state;
      const content = msg.content ?? [];
      const text = extractText(content);
      const thinking = extractThinking(content);
      const error =
        msg.stopReason === "error"
          ? (msg.errorMessage ?? "The model returned an error.")
          : undefined;

      let [next, id] = ensureAssistant(state);
      let thinkId = next.currentThinkingStepId;
      let proseId = next.currentProseId;
      let seq = next.seq;
      const now = Date.now();

      next = updateAssistant({ ...next, currentAssistantId: id }, (a) => {
        let parts = a.parts;
        // Finalize this message's thinking step.
        if (thinkId && thinking) {
          parts = patchWorkStep(parts, thinkId, {
            output: thinking,
            status: "complete",
          });
        }
        // Finalize this message's prose (tool calls in the same message do NOT
        // erase it — they become the next work chunk via tool_execution_start).
        if (text) {
          if (!proseId) proseId = `p${seq++}`;
          parts = writeProse(parts, proseId, text, false, now);
        }
        return { ...a, parts, error: error ?? a.error };
      });

      return {
        ...next,
        seq,
        currentThinkingStepId: null,
        currentProseId: null,
      };
    }

    case "tool_execution_start": {
      let [next, id] = ensureAssistant(state);
      const meta = toolStepMeta(ev.toolName, ev.args);
      const now = Date.now();
      const workId = `w${next.seq}`;
      next = updateAssistant({ ...next, currentAssistantId: id }, (a) => ({
        ...a,
        parts: stepIntoWork(
          a.parts,
          {
            id: ev.toolCallId,
            kind: "tool",
            icon: meta.icon,
            label: meta.label,
            status: "active",
          },
          workId,
          now,
        ),
      }));
      // A work chunk opened → the current prose segment is done; later text
      // starts a fresh prose part (a new bubble below this chunk).
      return { ...next, seq: next.seq + 1, currentProseId: null };
    }

    case "tool_execution_update":
      return updateAssistant(state, (a) => ({
        ...a,
        parts: patchWorkStep(a.parts, ev.toolCallId, {
          output: textFromResult(ev.partialResult),
        }),
      }));

    case "tool_execution_end":
      return updateAssistant(state, (a) => ({
        ...a,
        parts: patchWorkStep(a.parts, ev.toolCallId, {
          status: ev.isError ? "error" : "complete",
          output: textFromResult(ev.result),
        }),
      }));

    // ── queue / compaction / retry ───────────────────────────────────
    case "queue_update":
      return {
        ...state,
        queue: { steering: ev.steering ?? [], followUp: ev.followUp ?? [] },
      };

    case "compaction_start":
      return {
        ...state,
        items: [
          ...state.items.filter((it) => it.id !== "compaction"),
          {
            type: "notice",
            id: "compaction",
            variant: "compaction",
            text: "Compacting context…",
          },
        ],
      };

    case "compaction_end":
      return {
        ...state,
        items: state.items.filter((it) => it.id !== "compaction"),
      };

    case "auto_retry_start":
      return {
        ...state,
        items: [
          ...state.items.filter((it) => it.id !== "retry"),
          {
            type: "notice",
            id: "retry",
            variant: "retry",
            text: `Retrying (${ev.attempt}/${ev.maxAttempts})…`,
          },
        ],
      };

    case "auto_retry_end":
      return { ...state, items: state.items.filter((it) => it.id !== "retry") };

    case "extension_error":
      return {
        ...state,
        seq: state.seq + 1,
        items: [
          ...state.items,
          { type: "notice", id: `err${state.seq}`, variant: "error", text: ev.error },
        ],
      };

    case "extension_ui_request":
      return reduceUiRequest(state, ev);

    default:
      return state;
  }
}

function reduceUiRequest(
  state: SessionState,
  ev: ExtensionUiRequest,
): SessionState {
  const push = (item: ChatItem): SessionState => ({
    ...state,
    items: [...state.items, item],
  });
  switch (ev.method) {
    case "select":
      return push({
        type: "question",
        id: ev.id,
        method: "select",
        title: ev.title,
        options: ev.options,
        timeout: ev.timeout,
      });
    case "confirm":
      return push({
        type: "question",
        id: ev.id,
        method: "confirm",
        title: ev.title,
        message: ev.message,
        timeout: ev.timeout,
      });
    case "input":
      return push({
        type: "question",
        id: ev.id,
        method: "input",
        title: ev.title,
        placeholder: ev.placeholder,
        timeout: ev.timeout,
      });
    case "editor":
      return push({
        type: "question",
        id: ev.id,
        method: "editor",
        title: ev.title,
        prefill: ev.prefill,
        timeout: ev.timeout,
      });
    case "notify":
      return push({
        type: "notice",
        id: ev.id,
        variant: ev.notifyType ?? "info",
        text: ev.message,
      });
    default:
      // Fire-and-forget chrome (setStatus/setWidget/setTitle/…) — no-op.
      return state;
  }
}
