import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/systemPrompt.js";

describe("buildSystemPrompt — capability-gated sections", () => {
  it("emits only github sections when only github is active", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: ["github"],
      toolNames: ["github_search_code", "github_get_file", "github_list_workflow_runs", "github_get_workflow_run_logs"],
    });

    // GitHub tools must be present
    expect(prompt).toContain("github_search_code");

    // All other capability-specific strings must be absent
    expect(prompt).not.toContain("Gmail");
    expect(prompt).not.toContain("gmail_search");
    expect(prompt).not.toContain("Linear");
    expect(prompt).not.toContain("linear_search_issues");
    expect(prompt).not.toContain("slack_search_messages");
    expect(prompt).not.toContain("calendar_list_events");
    expect(prompt).not.toContain("cloudwatch_logs_query");
  });

  it("emits gmail and linear sections together when both are active", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: ["gmail", "linear"],
      toolNames: [
        "gmail_search",
        "gmail_get_message",
        "linear_search_issues",
        "linear_get_issue",
        "linear_create_issue",
        "linear_update_issue",
        "linear_add_comment",
        "linear_list_my_issues",
      ],
    });

    // All eight tool names must be present
    expect(prompt).toContain("gmail_search");
    expect(prompt).toContain("gmail_get_message");
    expect(prompt).toContain("linear_search_issues");
    expect(prompt).toContain("linear_get_issue");
    expect(prompt).toContain("linear_create_issue");
    expect(prompt).toContain("linear_update_issue");
    expect(prompt).toContain("linear_add_comment");
    expect(prompt).toContain("linear_list_my_issues");

    // Linear section header must be present
    expect(prompt).toContain("Linear (project management):");

    // Other capability tools must be absent
    expect(prompt).not.toContain("github_search_code");
    expect(prompt).not.toContain("slack_search_messages");
    expect(prompt).not.toContain("calendar_list_events");
    expect(prompt).not.toContain("cloudwatch_logs_query");
  });

  it("emits only always-on sections when no capabilities and no tools are active", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
    });

    // Always-on sections must be present
    expect(prompt).toContain("You are tino");
    expect(prompt).toContain("Current date and time:");
    expect(prompt).toContain("Current ISO-8601 timestamp:");
    expect(prompt).toContain("Behavior:");
    expect(prompt).toContain("Memory:");
    expect(prompt).toContain("Formatting:");
    expect(prompt).toContain("Tone and style:");

    // Capability-specific and tool-gated sections must be absent
    expect(prompt).not.toContain("You have these tools available:");
    expect(prompt).not.toContain("Linear (project management):");
    expect(prompt).not.toContain("Slack tool selection");
    expect(prompt).not.toContain("Linear tool selection:");
    expect(prompt).not.toContain("Task scheduling:");
    expect(prompt).not.toContain("Compound tasks:");
    expect(prompt).not.toContain("Preferences:");
  });

  it("emits compound-tasks section only when calendar, gmail, and github are all active", () => {
    const allThreeTools = [
      "calendar_list_events",
      "gmail_search",
      "gmail_get_message",
      "github_search_code",
      "github_get_file",
      "github_list_workflow_runs",
      "github_get_workflow_run_logs",
    ];

    // All three active → compound tasks present
    const promptAll = buildSystemPrompt({
      activeCapabilities: ["calendar", "gmail", "github"],
      toolNames: allThreeTools,
    });
    expect(promptAll).toContain("Compound tasks:");

    // Only calendar + gmail → compound tasks absent
    const promptCalGmail = buildSystemPrompt({
      activeCapabilities: ["calendar", "gmail"],
      toolNames: ["calendar_list_events", "gmail_search", "gmail_get_message"],
    });
    expect(promptCalGmail).not.toContain("Compound tasks:");

    // Only calendar + github → compound tasks absent
    const promptCalGithub = buildSystemPrompt({
      activeCapabilities: ["calendar", "github"],
      toolNames: ["calendar_list_events", "github_search_code", "github_get_file"],
    });
    expect(promptCalGithub).not.toContain("Compound tasks:");

    // Only gmail + github → compound tasks absent
    const promptGmailGithub = buildSystemPrompt({
      activeCapabilities: ["gmail", "github"],
      toolNames: ["gmail_search", "gmail_get_message", "github_search_code", "github_get_file"],
    });
    expect(promptGmailGithub).not.toContain("Compound tasks:");
  });

  it("gates preferences section on actual tool presence", () => {
    // Tools present, no capabilities → preferences section emitted
    const promptWithPrefs = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: ["set_preference", "get_preferences"],
    });
    expect(promptWithPrefs).toContain("Preferences:");
    expect(promptWithPrefs).toContain("set_preference(");

    // Tools absent, non-trivial capabilities → preferences section NOT emitted
    const promptWithoutPrefs = buildSystemPrompt({
      activeCapabilities: ["github", "gmail"],
      toolNames: ["github_search_code", "gmail_search", "gmail_get_message"],
    });
    expect(promptWithoutPrefs).not.toContain("Preferences:");
    expect(promptWithoutPrefs).not.toContain("set_preference(");
  });

  it("gates task-scheduling section on actual tool presence", () => {
    // Tools present, no capabilities → task scheduling section emitted
    const promptWithTasks = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: ["schedule_task", "list_tasks", "cancel_task"],
    });
    expect(promptWithTasks).toContain("Task scheduling:");
    expect(promptWithTasks).toContain("schedule_task(");

    // Tools absent, non-trivial capabilities → task scheduling section NOT emitted
    const promptWithoutTasks = buildSystemPrompt({
      activeCapabilities: ["calendar", "gmail", "github"],
      toolNames: ["calendar_list_events", "gmail_search", "github_search_code"],
    });
    expect(promptWithoutTasks).not.toContain("Task scheduling:");
    expect(promptWithoutTasks).not.toContain("schedule_task(");
  });
});

describe("buildSystemPrompt — wave 5 instructions", () => {
  it("system prompt includes Instructions section when behaviorChunks present", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      instructions: {
        permissions: { write: true, delete: true, crossContextShare: true },
        behaviorChunks: [
          { source: "org-policy", text: "respond in Spanish" },
          { source: "user-prefs", text: "be extra concise" },
        ],
      },
    });
    expect(prompt).toContain("Instructions:");
    expect(prompt).toContain("[org-policy] respond in Spanish");
    expect(prompt).toContain("[user-prefs] be extra concise");
    // org-policy appears before user-prefs
    expect(prompt.indexOf("[org-policy]")).toBeLessThan(prompt.indexOf("[user-prefs]"));
  });

  it("system prompt includes Permissions section when actions are denied", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      instructions: {
        permissions: { write: false, delete: true, crossContextShare: false },
        behaviorChunks: [],
      },
    });
    expect(prompt).toContain("Permissions:");
    expect(prompt).toContain("write");
    expect(prompt).toContain("cross-context sharing");
    expect(prompt).not.toContain("delete");
  });

  it("system prompt omits Permissions section when all allowed", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      instructions: {
        permissions: { write: true, delete: true, crossContextShare: true },
        behaviorChunks: [],
      },
    });
    expect(prompt).not.toContain("Permissions:");
  });

  it("system prompt omits Instructions section when no behaviorChunks", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      instructions: {
        permissions: { write: true, delete: true, crossContextShare: true },
        behaviorChunks: [],
      },
    });
    expect(prompt).not.toContain("Instructions:");
  });

  it("system prompt works without instructions (backward compat)", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
    });
    expect(prompt).toContain("You are tino");
    expect(prompt).not.toContain("Instructions:");
    expect(prompt).not.toContain("Permissions:");
  });
});
