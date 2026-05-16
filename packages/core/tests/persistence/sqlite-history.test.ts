import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelMessage } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteHistoryStore } from "../../src/persistence/sqlite.js";

// ─── Helper builders (same shapes as tests/agent/history.test.ts) ────────────

const userMsg = (text: string): ModelMessage => ({
  role: "user",
  content: text,
});

const assistantMsg = (text: string): ModelMessage => ({
  role: "assistant",
  content: text,
});

const assistantToolCallMsg = (toolCallId: string): ModelMessage => ({
  role: "assistant",
  content: [
    {
      type: "tool-call",
      toolCallId,
      toolName: "test_tool",
      input: {},
    },
  ],
});

const toolResultMsg = (toolCallId: string): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId,
      toolName: "test_tool",
      output: { type: "text", value: "result" },
    },
  ],
});

// ─── Temp-file management ─────────────────────────────────────────────────────

const tempFiles: string[] = [];

function tempDbPath(): string {
  const p = path.join(os.tmpdir(), `tino-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempFiles.push(p);
  return p;
}

afterEach(() => {
  // Clean up all temp DB files created during the test
  for (const p of tempFiles.splice(0)) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(p + suffix);
      } catch {
        /* ignore */
      }
    }
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createSqliteHistoryStore", () => {
  it("empty store returns empty array", async () => {
    const store = createSqliteHistoryStore({ dbPath: tempDbPath() });
    expect(await store.get("U1")).toEqual([]);
  });

  it("round-trip across instance close/reopen", async () => {
    const dbPath = tempDbPath();

    // First instance: write 4 messages
    const msgs: ModelMessage[] = [
      userMsg("hello"),
      assistantMsg("hi there"),
      userMsg("how are you"),
      assistantMsg("doing well"),
    ];
    {
      const store = createSqliteHistoryStore({ dbPath });
      await store.append("U1", msgs);
      // store goes out of scope here — better-sqlite3 closes on GC
    }

    // Second instance at same path: should read back the same messages
    const store2 = createSqliteHistoryStore({ dbPath });
    expect(await store2.get("U1")).toEqual(msgs);
  });

  it("cap trimming honored", async () => {
    const store = createSqliteHistoryStore({ dbPath: tempDbPath(), cap: 5 });
    const msgs: ModelMessage[] = [
      userMsg("1"),
      assistantMsg("2"),
      userMsg("3"),
      assistantMsg("4"),
      userMsg("5"),
      assistantMsg("6"),
      userMsg("7"),
      assistantMsg("8"),
    ];
    await store.append("U1", msgs);
    const result = await store.get("U1");
    expect(result).toHaveLength(5);
    expect(result).toEqual(msgs.slice(3)); // last 5: indices 3–7
  });

  it("multiple users are isolated", async () => {
    const store = createSqliteHistoryStore({ dbPath: tempDbPath() });
    await store.append("U1", [userMsg("hello from U1")]);
    await store.append("U2", [userMsg("hello from U2")]);

    expect(await store.get("U1")).toHaveLength(1);
    expect((await store.get("U1"))[0]).toMatchObject({ role: "user", content: "hello from U1" });

    expect(await store.get("U2")).toHaveLength(1);
    expect((await store.get("U2"))[0]).toMatchObject({ role: "user", content: "hello from U2" });
  });

  it("reset wipes one user and leaves the other intact", async () => {
    const store = createSqliteHistoryStore({ dbPath: tempDbPath() });
    await store.append("U1", [userMsg("u1 msg")]);
    await store.append("U2", [userMsg("u2 msg")]);

    await store.reset("U1");

    expect(await store.get("U1")).toEqual([]);
    expect(await store.get("U2")).toHaveLength(1);
    expect((await store.get("U2"))[0]).toMatchObject({ role: "user", content: "u2 msg" });
  });

  it("trim invariant: orphan tool messages skipped at trim boundary", async () => {
    const store = createSqliteHistoryStore({ dbPath: tempDbPath(), cap: 5 });

    // 6 messages; with cap=5, naive trim keeps [1..5].
    // Index 1 is role='tool' — orphaned because its assistant (index 0) was trimmed.
    // Orphan-skip logic should advance past it, returning [2..5] (4 messages).
    const msgs: ModelMessage[] = [
      assistantMsg("plain text response"), // [0] — trimmed
      toolResultMsg("call-1"), // [1] — orphan after trim
      userMsg("follow-up"), // [2]
      assistantToolCallMsg("call-2"), // [3]
      toolResultMsg("call-2"), // [4]
      userMsg("another question"), // [5]
    ];

    await store.append("U1", msgs);
    const result = await store.get("U1");

    expect(result[0]?.role).not.toBe("tool");
    expect(result).toHaveLength(4);
    expect(result).toEqual(msgs.slice(2));
  });
});
