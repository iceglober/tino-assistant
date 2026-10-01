import { describe, expect, it } from "vitest";
import { buildSystemPrompt, type RecalledMessage } from "../../src/domain/prompt.js";
import { describeModelMessage } from "../../src/infrastructure/driven/model/describe-message.js";

describe("system prompt: who reads the reply", () => {
  it("says nothing extra when only the asker reads it", () => {
    const p = buildSystemPrompt({ toolNames: [] });
    expect(p).not.toContain("Who reads this");
  });

  it("warns that the channel reads it, and points to the DM hand-off when offered", () => {
    const withHandOff = buildSystemPrompt({
      toolNames: ["continue_in_dm"],
      readers: { onlyTheAsker: false, includesOutsiders: false },
    });
    expect(withHandOff).toContain("Everyone in the channel reads your replies");
    expect(withHandOff).toContain("call `continue_in_dm`");
    expect(withHandOff).not.toContain("outside the company");

    const without = buildSystemPrompt({ toolNames: [], readers: { onlyTheAsker: false, includesOutsiders: false } });
    expect(without).toContain("tell them to DM you");
  });

  it("names outsiders when present", () => {
    const p = buildSystemPrompt({ toolNames: [], readers: { onlyTheAsker: false, includesOutsiders: true } });
    expect(p).toContain("People from outside the company are in this channel");
  });

  it("describes the renamed tools", () => {
    const p = buildSystemPrompt({
      toolNames: ["kb_what_the_workspace_knows", "kb_what_you_know", "slack_read_this_channel", "mcp_linear_search"],
    });
    expect(p).toContain("kb_what_the_workspace_knows");
    expect(p).toContain("what you know about this person");
    expect(p).toContain("slack_read_this_channel");
    expect(p).toContain("mcp_<server>_<tool>");
  });
});

describe("system prompt: recalled messages", () => {
  const at = Date.UTC(2026, 8, 30, 14, 5);
  const recalled: RecalledMessage[] = [
    { role: "user", text: "where are we on acme?", where: "channel", channelId: "CSALES", at },
    { role: "tino", text: "renewal is friday", where: "slack_dm", channelId: null, at },
    { role: "user", text: "x".repeat(600), where: "web_chat", channelId: null, at },
  ];

  it("lists them with where and when, trimmed", () => {
    const p = buildSystemPrompt({ toolNames: [], recalled });
    expect(p).toContain("Earlier, elsewhere");
    expect(p).toContain("[2026-09-30 14:05 · <#CSALES>] them: where are we on acme?");
    expect(p).toContain("· DM] you: renewal is friday");
    expect(p).toContain("· web chat] them: ");
    expect(p).toContain(`${"x".repeat(400)}…`);
    expect(p).not.toContain("x".repeat(401));
  });

  it("omits the section when there's nothing to recall", () => {
    expect(buildSystemPrompt({ toolNames: [], recalled: [] })).not.toContain("Earlier, elsewhere");
  });
});

describe("describeModelMessage", () => {
  it("pulls readable text and hides tool traffic", () => {
    expect(describeModelMessage({ role: "user", content: "hi" })).toEqual({ role: "user", text: "hi" });
    expect(
      describeModelMessage({
        role: "assistant",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toEqual({ role: "assistant", text: "ab" });
    expect(
      describeModelMessage({
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "1", toolName: "t", input: {} }],
      }),
    ).toEqual({ role: "assistant", text: null });
    expect(describeModelMessage({ role: "tool", content: [] })).toEqual({ role: "tool", text: null });
  });
});
