// Pi session-store parsing — the sidebar's listing metadata. This parser has
// two mirrors (dev/pi-bridge.ts reads disk with it; src-tauri/src/pi.rs
// reimplements it in Rust) — behavior changes here must be ported there.

import { describe, expect, test } from "bun:test";
import {
  encodeCwdDir,
  parseSessionMeta,
} from "@/lib/adapters/pi/store-format";

const HEADER = {
  type: "session",
  id: "s-123",
  cwd: "/Users/x/proj",
  timestamp: "2026-07-07T19:39:25.407Z",
};

function file(...lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

describe("parseSessionMeta", () => {
  test("title comes from the first user message; counts user+assistant", () => {
    const meta = parseSessionMeta(
      file(
        HEADER,
        { type: "message", message: { role: "user", content: "fix the bug please" } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
        { type: "message", message: { role: "toolResult", content: [] } },
      ),
      "/store/a.jsonl",
      1_700_000,
    );
    expect(meta).toMatchObject({
      id: "s-123",
      cwd: "/Users/x/proj",
      title: "fix the bug please",
      messages: 2,
      updatedAt: 1_700_000,
    });
    expect(meta?.createdAt).toBe(Date.parse("2026-07-07T19:39:25.407Z"));
  });

  test("the LATEST session_info name wins and becomes the title", () => {
    const meta = parseSessionMeta(
      file(
        HEADER,
        { type: "message", message: { role: "user", content: "hello" } },
        { type: "session_info", name: "First name" },
        { type: "session_info", name: "Renamed" },
      ),
      "/store/a.jsonl",
      1,
    );
    expect(meta?.name).toBe("Renamed");
    expect(meta?.title).toBe("Renamed");
  });

  test("empty shells (no user turn, no name) are skipped", () => {
    expect(parseSessionMeta(file(HEADER), "/store/a.jsonl", 1)).toBeNull();
  });

  test("garbage lines and CRLF endings don't break parsing", () => {
    const content =
      JSON.stringify(HEADER) +
      "\r\n" +
      "not json at all\n" +
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "yo" }] },
      }) +
      "\n";
    const meta = parseSessionMeta(content, "/store/a.jsonl", 1);
    expect(meta?.title).toBe("yo");
  });

  test("a file with no session header is skipped", () => {
    expect(
      parseSessionMeta(
        file({ type: "message", message: { role: "user", content: "hi" } }),
        "/store/a.jsonl",
        1,
      ),
    ).toBeNull();
  });
});

describe("encodeCwdDir", () => {
  test("mirrors pi's SessionManager encoding", () => {
    expect(encodeCwdDir("/Users/x/my proj")).toBe("--Users-x-my proj--");
    expect(encodeCwdDir("/a/b:c")).toBe("--a-b-c--");
  });
});
