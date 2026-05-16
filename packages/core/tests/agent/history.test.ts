import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { createHistoryStore } from "../../src/agent/history.js";

// Helper builders — only the `role` field matters for trim logic.
// We use `satisfies ModelMessage` to get type-checking without fighting
// the full content shape in test fixtures.

const userMsg = (text: string): ModelMessage => ({
  role: "user",
  content: text,
});

const assistantMsg = (text: string): ModelMessage => ({
  role: "assistant",
  content: text,
});

/**
 * An assistant message that contains a tool call.
 * The trim logic only inspects `role`, so the content shape is minimal.
 */
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

/**
 * A tool-result message (role: 'tool').
 * The trim logic only inspects `role`, so the content shape is minimal.
 */
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

describe("createHistoryStore", () => {
  it("empty store returns empty array", async () => {
    const store = createHistoryStore();
    expect(await store.get("U1")).toEqual([]);
  });

  it("single append, no trim — returns all messages in order", async () => {
    const store = createHistoryStore({ cap: 40 });
    const msgs: ModelMessage[] = [userMsg("a"), assistantMsg("b"), userMsg("c"), assistantMsg("d"), userMsg("e")];
    await store.append("U1", msgs);
    expect(await store.get("U1")).toEqual(msgs);
  });

  it("multiple users are isolated", async () => {
    const store = createHistoryStore({ cap: 40 });
    await store.append("U1", [userMsg("hello from U1")]);
    await store.append("U2", [userMsg("hello from U2")]);

    expect(await store.get("U1")).toHaveLength(1);
    expect((await store.get("U1"))[0]).toMatchObject({ role: "user", content: "hello from U1" });

    expect(await store.get("U2")).toHaveLength(1);
    expect((await store.get("U2"))[0]).toMatchObject({ role: "user", content: "hello from U2" });
  });

  it("cap trimming preserves order and keeps the newest messages", async () => {
    const store = createHistoryStore({ cap: 5 });
    // Append 8 alternating user/assistant messages
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
    // Should keep the last 5 in original order
    expect(result).toHaveLength(5);
    expect(result).toEqual(msgs.slice(3)); // indices 3–7
  });

  it("cap trimming skips orphan tool messages at the trim boundary", async () => {
    const store = createHistoryStore({ cap: 5 });

    // Build 6 messages:
    // [0] assistant(text)
    // [1] tool(result for [0]'s call — but [0] is a plain text assistant, so this is
    //     actually an orphan scenario we construct deliberately)
    // [2] user
    // [3] assistant(toolCall)
    // [4] tool(result for [3])
    // [5] user
    //
    // With cap=5, naive trim drops index 0 and keeps [1..5].
    // Index 1 is role='tool' — it's now orphaned (its assistant was trimmed).
    // The orphan-skip logic should advance past it, returning [2..5] (4 messages).
    const msgs: ModelMessage[] = [
      assistantMsg("plain text response"), // [0] — will be trimmed
      toolResultMsg("call-1"), // [1] — orphan after trim
      userMsg("follow-up"), // [2]
      assistantToolCallMsg("call-2"), // [3]
      toolResultMsg("call-2"), // [4]
      userMsg("another question"), // [5]
    ];

    await store.append("U1", msgs);
    const result = await store.get("U1");

    // Must not start with a tool role
    expect(result[0]?.role).not.toBe("tool");
    // Should be 4 messages: [2..5]
    expect(result).toHaveLength(4);
    expect(result).toEqual(msgs.slice(2));
  });

  it("reset wipes one user and leaves the other intact", async () => {
    const store = createHistoryStore({ cap: 40 });
    await store.append("U1", [userMsg("u1 msg")]);
    await store.append("U2", [userMsg("u2 msg")]);

    await store.reset("U1");

    expect(await store.get("U1")).toEqual([]);
    expect(await store.get("U2")).toHaveLength(1);
    expect((await store.get("U2"))[0]).toMatchObject({ role: "user", content: "u2 msg" });
  });
});
