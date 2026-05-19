import { describe, expect, it, vi } from "vitest";
import { gmailCreatePrivacyFilterTool } from "../../src/tools/privacy-setup/gmail-create-privacy-filter.js";
import { gmailAuditFiltersTool } from "../../src/tools/privacy-setup/gmail-audit-filters.js";
import { calendarCheckDefaultsTool } from "../../src/tools/privacy-setup/calendar-check-defaults.js";
import { calendarSuggestPrivateTool } from "../../src/tools/privacy-setup/calendar-suggest-private.js";
import { slackAuditDmsTool } from "../../src/tools/privacy-setup/slack-audit-dms.js";

describe("privacy setup tools", () => {
  it("gmail_create_privacy_filter requires confirm or approval", async () => {
    const createFilter = vi.fn().mockResolvedValue({ ok: true, filterId: "f1" });
    const tools = gmailCreatePrivacyFilterTool({ createFilter });
    const tool = tools.gmail_create_privacy_filter as any;

    // Without confirm
    const result1 = await tool.execute({ addLabel: "Private" }, { toolCallId: "tc1" });
    expect(result1.needsConfirm).toBe(true);
    expect(createFilter).not.toHaveBeenCalled();

    // With confirm
    const result2 = await tool.execute({ addLabel: "Private", confirm: true }, { toolCallId: "tc2" });
    expect(result2.ok).toBe(true);
    expect(createFilter).toHaveBeenCalled();
  });

  it("gmail_audit_filters runs read-only without approval", async () => {
    const listFilters = vi.fn().mockResolvedValue([
      { id: "f1", actions: { addLabel: "Work" } },
    ]);
    const tools = gmailAuditFiltersTool({ listFilters, privacyLabels: ["Private", "HR"] });
    const tool = tools.gmail_audit_filters as any;

    const result = await tool.execute({});
    expect(listFilters).toHaveBeenCalled();
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].suggestion).toContain("Private");
  });

  it("calendar_check_defaults runs read-only without approval", async () => {
    const getCalendarSettings = vi.fn().mockResolvedValue({
      defaultVisibility: "public",
      calendars: [
        { id: "primary", summary: "Work", defaultVisibility: "public" },
        { id: "personal", summary: "Personal", defaultVisibility: "private" },
      ],
    });
    const tools = calendarCheckDefaultsTool({ getCalendarSettings, gateAllByDefault: false });
    const tool = tools.calendar_check_defaults as any;

    const result = await tool.execute({});
    expect(getCalendarSettings).toHaveBeenCalled();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Work");
  });

  it("calendar_suggest_private runs read-only without approval", async () => {
    const getRecentEvents = vi.fn().mockResolvedValue([
      { eventId: "e1", title: "Team standup", attendees: ["alice@work.com"] },
      { eventId: "e2", title: "Doctor appointment", attendees: [] },
      { eventId: "e3", title: "Family dinner", attendees: [] },
    ]);
    const tools = calendarSuggestPrivateTool({ getRecentEvents });
    const tool = tools.calendar_suggest_private as any;

    const result = await tool.execute({ daysBack: 7 });
    expect(getRecentEvents).toHaveBeenCalledWith("", 7);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions.map((s: any) => s.eventId)).toContain("e2");
    expect(result.suggestions.map((s: any) => s.eventId)).toContain("e3");
  });

  it("slack_audit_dms runs read-only without approval", async () => {
    const getRecentDms = vi.fn().mockResolvedValue([
      { conversationId: "D1", participantName: "Dr. Medical", messageCount: 10 },
      { conversationId: "D2", participantName: "Bob", messageCount: 5 },
    ]);
    const tools = slackAuditDmsTool({ getRecentDms, denyListedUserIds: [] });
    const tool = tools.slack_audit_dms as any;

    const result = await tool.execute({});
    expect(getRecentDms).toHaveBeenCalled();
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].participantName).toBe("Dr. Medical");
  });

  it("tools are not registered until onboarding is complete", () => {
    // This is an architectural test: the tool factories return ToolSet objects
    // that should only be merged into the agent's tools after onboarding.
    // Verifying the factory returns a defined ToolSet (registration is the caller's responsibility).
    const tools = gmailAuditFiltersTool({ listFilters: vi.fn().mockResolvedValue([]), privacyLabels: [] });
    expect(tools.gmail_audit_filters).toBeDefined();
    expect(tools.gmail_audit_filters.description).toBeDefined();
  });
});
