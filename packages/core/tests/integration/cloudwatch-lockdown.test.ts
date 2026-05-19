import { describe, expect, it, vi } from "vitest";
import { logToolResult, isPrivateCapabilityTool } from "../../src/logging/redaction.js";

function captureLogger() {
  const entries: Array<{ args: unknown; msg: string }> = [];
  return {
    logger: {
      info: vi.fn((args: unknown, msg: string) => entries.push({ args, msg })),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    entries,
  };
}

describe("CloudWatch lockdown", () => {
  it("gmail tool result body never appears in log output", () => {
    const { logger, entries } = captureLogger();
    const sensitiveResult = { messages: [{ id: "m1", from: "therapist@example.com", body: "session notes" }] };

    logToolResult(logger, { toolName: "gmail_search" }, sensitiveResult);

    expect(entries).toHaveLength(1);
    const logged = entries[0].args as Record<string, unknown>;
    expect(logged.body).toBe("<redacted: private capability>");
    expect(JSON.stringify(logged)).not.toContain("therapist");
    expect(JSON.stringify(logged)).not.toContain("session notes");
  });

  it("calendar tool result body never appears in log output", () => {
    const { logger, entries } = captureLogger();
    const sensitiveResult = { events: [{ summary: "Therapy appointment", visibility: "private" }] };

    logToolResult(logger, { toolName: "calendar_list_events" }, sensitiveResult);

    const logged = entries[0].args as Record<string, unknown>;
    expect(logged.body).toBe("<redacted: private capability>");
    expect(JSON.stringify(logged)).not.toContain("Therapy");
  });

  it("slack-personal tool result body never appears in log output", () => {
    const { logger, entries } = captureLogger();
    const sensitiveResult = { messages: [{ user: "U1", text: "confidential DM content" }] };

    logToolResult(logger, { toolName: "slack_read_dm" }, sensitiveResult);

    const logged = entries[0].args as Record<string, unknown>;
    expect(logged.body).toBe("<redacted: private capability>");
    expect(JSON.stringify(logged)).not.toContain("confidential");
  });

  it("shared capability tool results may appear in logs", () => {
    const { logger, entries } = captureLogger();
    const publicResult = { files: [{ path: "src/index.ts", url: "https://github.com/..." }] };

    logToolResult(logger, { toolName: "github_search_code", capabilityId: "github" }, publicResult);

    const logged = entries[0].args as Record<string, unknown>;
    expect(logged.body).toEqual(publicResult);
  });

  it("isPrivateCapabilityTool correctly classifies tools", () => {
    expect(isPrivateCapabilityTool("gmail_search")).toBe(true);
    expect(isPrivateCapabilityTool("gmail_get_message")).toBe(true);
    expect(isPrivateCapabilityTool("calendar_list_events")).toBe(true);
    expect(isPrivateCapabilityTool("slack_read_dm")).toBe(true);
    expect(isPrivateCapabilityTool("slack_list_dms")).toBe(true);
    expect(isPrivateCapabilityTool("github_search_code")).toBe(false);
    expect(isPrivateCapabilityTool("linear_search_issues")).toBe(false);
  });
});
