import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/systemPrompt.js";
import type { DiscoveryResult } from "../../src/discovery/types.js";

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

// ── User Profile (discovery) section ────────────────────────────────────────

const fullDiscovery: DiscoveryResult = {
  roleSummary: "Engineering manager for the platform team.",
  inferredTitle: "Engineering Manager",
  inferredDepartment: "Platform",
  orgRelationships: [
    {
      name: "Alice",
      relationship: "peer",
      context: "co-leads the infra working group",
      interactionFrequency: "weekly",
    },
    {
      name: "Bob",
      relationship: "reports-to",
      context: "1:1 every Monday",
      interactionFrequency: "weekly",
    },
    {
      name: "Carol",
      relationship: "direct-report",
      context: "owns the deploy pipeline",
      interactionFrequency: "daily",
    },
    {
      name: "Dave",
      relationship: "stakeholder",
      context: "PM partner for Q2 roadmap",
      interactionFrequency: "biweekly",
    },
  ],
  responsibilities: [
    {
      title: "Triage incidents",
      description: "Page rotation",
      timeHorizon: "daily",
      evidence: "PagerDuty schedule",
    },
    {
      title: "Plan quarterly roadmap",
      description: "OKR planning",
      timeHorizon: "quarterly",
      evidence: "Linear projects",
    },
    {
      title: "Run team standup",
      description: "Daily sync",
      timeHorizon: "weekly",
      evidence: "Calendar events",
    },
    {
      title: "Performance reviews",
      description: "1:1 cadence",
      timeHorizon: "monthly",
      evidence: "Calendar 1:1s",
    },
    {
      title: "Mentor engineers",
      description: "Career growth",
      timeHorizon: "ongoing",
      evidence: "Slack DMs",
    },
  ],
  communicationStyle: {
    summary: "Direct and async-first.",
    preferredChannels: ["slack", "email"],
    patterns: ["batches replies in mornings"],
  },
  workPatterns: {
    meetingLoad: "heavy (20+ hrs/week)",
    peakHours: "9am-12pm",
    recurringCommitments: ["daily standup 9am"],
    timeInvestment: [
      { category: "meetings", estimatedPct: 40, details: "many 1:1s" },
      { category: "code review", estimatedPct: 20, details: "PR reviews" },
    ],
  },
  painPoints: ["context switching between Slack and email", "too many recurring meetings"],
  suggestions: [],
  analyzedAt: 1_700_000_000_000,
  dataSourcesUsed: ["gmail", "calendar", "slack"],
};

describe("buildSystemPrompt — User Profile (discovery) section", () => {
  it("renders all User Profile sub-sections when a full discovery is provided", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      discovery: fullDiscovery,
    });

    expect(prompt).toContain("User Profile:");
    expect(prompt).toContain("Role: Engineering Manager — Platform");
    expect(prompt).toContain("Key relationships:");
    expect(prompt).toContain("Responsibilities:");
    expect(prompt).toContain("Communication style:");
    expect(prompt).toContain("Work patterns:");
    expect(prompt).toContain("Known pain points:");
  });

  it("renders reports-to and direct-report relationships before other relationship types", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      discovery: fullDiscovery,
    });

    const bobIdx = prompt.indexOf("Bob");
    const carolIdx = prompt.indexOf("Carol");
    const aliceIdx = prompt.indexOf("Alice");
    const daveIdx = prompt.indexOf("Dave");

    // reports-to (Bob) and direct-report (Carol) come before peer (Alice) and stakeholder (Dave)
    expect(bobIdx).toBeGreaterThan(0);
    expect(carolIdx).toBeGreaterThan(0);
    expect(aliceIdx).toBeGreaterThan(0);
    expect(daveIdx).toBeGreaterThan(0);
    expect(bobIdx).toBeLessThan(aliceIdx);
    expect(bobIdx).toBeLessThan(daveIdx);
    expect(carolIdx).toBeLessThan(aliceIdx);
    expect(carolIdx).toBeLessThan(daveIdx);
  });

  it("groups responsibilities by timeHorizon in order daily/weekly/monthly/quarterly/ongoing", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      discovery: fullDiscovery,
    });

    const dailyIdx = prompt.indexOf("Daily:");
    const weeklyIdx = prompt.indexOf("Weekly:");
    const monthlyIdx = prompt.indexOf("Monthly:");
    const quarterlyIdx = prompt.indexOf("Quarterly:");
    const ongoingIdx = prompt.indexOf("Ongoing:");

    expect(dailyIdx).toBeGreaterThan(0);
    expect(weeklyIdx).toBeGreaterThan(dailyIdx);
    expect(monthlyIdx).toBeGreaterThan(weeklyIdx);
    expect(quarterlyIdx).toBeGreaterThan(monthlyIdx);
    expect(ongoingIdx).toBeGreaterThan(quarterlyIdx);

    // The horizon labels should be followed by the responsibility titles
    expect(prompt).toContain("Daily: Triage incidents");
    expect(prompt).toContain("Weekly: Run team standup");
    expect(prompt).toContain("Monthly: Performance reviews");
    expect(prompt).toContain("Quarterly: Plan quarterly roadmap");
    expect(prompt).toContain("Ongoing: Mentor engineers");
  });

  it("omits the User Profile section entirely when no discovery is provided", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
    });
    expect(prompt).not.toContain("User Profile:");
    expect(prompt).not.toContain("Key relationships:");
    expect(prompt).not.toContain("Responsibilities:");
    expect(prompt).not.toContain("Communication style:");
    expect(prompt).not.toContain("Work patterns:");
    expect(prompt).not.toContain("Known pain points:");
  });

  it("places the User Profile section after the always-on prefix and before capability tool bullets", () => {
    const prompt = buildSystemPrompt({
      activeCapabilities: ["github"],
      toolNames: ["github_search_code", "github_get_file"],
      discovery: fullDiscovery,
    });

    const toneIdx = prompt.indexOf("Tone and style:");
    const profileIdx = prompt.indexOf("User Profile:");
    const toolsHeaderIdx = prompt.indexOf("You have these tools available:");

    expect(toneIdx).toBeGreaterThan(0);
    expect(profileIdx).toBeGreaterThan(toneIdx);
    expect(toolsHeaderIdx).toBeGreaterThan(profileIdx);
  });
});

// ── User Profile (discovery) — old-schema fallbacks ─────────────────────────

describe("buildSystemPrompt — User Profile old-schema fallbacks", () => {
  it("renders only roleSummary when inferredTitle/inferredDepartment/orgRelationships/responsibilities are absent", () => {
    // Old-schema discovery: only roleSummary, no new-schema fields.
    // Cast through unknown — old data won't satisfy DiscoveryResult's required fields.
    const oldSchema = {
      roleSummary: "Engineering manager for the platform team.",
    } as unknown as DiscoveryResult;

    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      discovery: oldSchema,
    });

    // User Profile header and roleSummary are present
    expect(prompt).toContain("User Profile:");
    expect(prompt).toContain("Engineering manager for the platform team.");

    // Must NOT contain a Role: line (no inferredTitle/inferredDepartment)
    expect(prompt).not.toMatch(/Role: .+ — .+/);

    // Must NOT contain the Key relationships header (orgRelationships absent)
    expect(prompt).not.toContain("Key relationships:");

    // Must NOT contain the Responsibilities header (responsibilities absent, no duties)
    expect(prompt).not.toContain("Responsibilities:");
  });

  it("renders old-schema duties as a bulleted Responsibilities section when responsibilities is missing", () => {
    const oldSchemaWithDuties = {
      roleSummary: "Backend engineer.",
      duties: ["foo", "bar"],
    } as unknown as DiscoveryResult;

    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      discovery: oldSchemaWithDuties,
    });

    expect(prompt).toContain("Responsibilities:");
    expect(prompt).toContain("- foo");
    expect(prompt).toContain("- bar");

    // Should not include any horizon labels (those only apply to new-schema responsibilities)
    expect(prompt).not.toMatch(/^Daily:/m);
    expect(prompt).not.toMatch(/^Weekly:/m);
  });

  it("does not emit Key relationships header when orgRelationships is an empty array", () => {
    const emptyRelationships = {
      roleSummary: "Solo contributor.",
      orgRelationships: [],
    } as unknown as DiscoveryResult;

    const prompt = buildSystemPrompt({
      activeCapabilities: [],
      toolNames: [],
      discovery: emptyRelationships,
    });

    expect(prompt).toContain("User Profile:");
    expect(prompt).not.toContain("Key relationships:");
  });

  it("does not throw when given a minimal old-schema discovery", () => {
    // All three minimal-shape variants should render without throwing.
    const minimal = { roleSummary: "Role." } as unknown as DiscoveryResult;
    const withDuties = { roleSummary: "Role.", duties: ["x"] } as unknown as DiscoveryResult;
    const emptyRels = { roleSummary: "Role.", orgRelationships: [] } as unknown as DiscoveryResult;

    expect(() => buildSystemPrompt({ activeCapabilities: [], toolNames: [], discovery: minimal })).not.toThrow();
    expect(() => buildSystemPrompt({ activeCapabilities: [], toolNames: [], discovery: withDuties })).not.toThrow();
    expect(() => buildSystemPrompt({ activeCapabilities: [], toolNames: [], discovery: emptyRels })).not.toThrow();
  });
});
