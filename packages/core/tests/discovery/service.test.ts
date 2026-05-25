/**
 * Tests for runDiscovery — the discovery service that orchestrates email,
 * calendar, and Slack ports, then runs an LLM analysis to produce a
 * structured DiscoveryResult.
 *
 * Mocks the `ai` module so generateObject never hits the network.
 */

import { generateObject } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDiscovery, type DiscoveryServiceDeps } from "../../src/discovery/service.ts";
import type { CalendarPort } from "../../src/discovery/calendar-port.ts";
import type { SlackDiscoveryPort } from "../../src/discovery/slack-port.ts";
import type { EmailPort } from "../../src/privacy/ports.ts";
import type { AppLogger } from "../../src/slack/app.ts";

// ---------------------------------------------------------------------------
// Mock the `ai` module so generateObject is observable without a network call.
// ---------------------------------------------------------------------------
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

const mockGenerateObject = vi.mocked(generateObject);

function makeLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as AppLogger;
}

// Stable LLM-shaped result; spread alongside analyzedAt + dataSourcesUsed.
const stubAnalysis = {
  roleSummary: "Founder/CTO of a small team.",
  inferredTitle: "CTO",
  inferredDepartment: "Engineering",
  orgRelationships: [
    {
      name: "Alice",
      relationship: "peer" as const,
      context: "weekly 1:1",
      interactionFrequency: "weekly",
    },
  ],
  responsibilities: [
    {
      title: "Eng leadership",
      description: "Leads engineering",
      timeHorizon: "ongoing" as const,
      evidence: "recurring 1:1s",
    },
  ],
  communicationStyle: {
    summary: "Async, batches replies.",
    preferredChannels: ["slack", "email"],
    patterns: ["responds quickly to DMs"],
  },
  workPatterns: {
    meetingLoad: "moderate",
    peakHours: "mornings",
    recurringCommitments: ["weekly team sync"],
    timeInvestment: [{ category: "meetings", estimatedPct: 40, details: "1:1s and team syncs" }],
  },
  painPoints: ["context switching"],
  suggestions: [{ title: "Daily digest", description: "Summarize overnight messages" }],
};

function makeEmailPort(): EmailPort {
  return {
    getContacts: vi.fn().mockResolvedValue([
      { address: "alice@example.com", displayName: "Alice", itemCount: 42 },
    ]),
    getLabels: vi.fn().mockResolvedValue([{ name: "INBOX", itemCount: 100 }]),
    getSampleSubjects: vi.fn().mockResolvedValue([{ label: "INBOX", subjects: ["hi", "follow up"] }]),
  } as unknown as EmailPort;
}

function makeCalendarPort(): CalendarPort {
  return {
    getEvents: vi.fn().mockResolvedValue([
      {
        title: "Weekly 1:1 with Alice",
        recurrence: "WEEKLY",
        attendees: ["alice@example.com"],
      },
      {
        title: "Q2 planning",
        recurrence: undefined,
        attendees: ["alice@example.com", "bob@example.com"],
      },
    ]),
  } as unknown as CalendarPort;
}

function makeSlackPort(): {
  port: SlackDiscoveryPort;
  spies: {
    getTopDMPartners: ReturnType<typeof vi.fn>;
    getActiveChannels: ReturnType<typeof vi.fn>;
    getMessageSample: ReturnType<typeof vi.fn>;
  };
} {
  const getTopDMPartners = vi
    .fn()
    .mockResolvedValue([{ name: "Alice", messageCount: 25 }]);
  const getActiveChannels = vi
    .fn()
    .mockResolvedValue([{ name: "#engineering", messageCount: 80 }]);
  const getMessageSample = vi
    .fn()
    .mockResolvedValue([{ channel: "#engineering", text: "shipping in an hour", ts: "1700000000.000" }]);
  return {
    port: { getTopDMPartners, getActiveChannels, getMessageSample } as unknown as SlackDiscoveryPort,
    spies: { getTopDMPartners, getActiveChannels, getMessageSample },
  };
}

describe("runDiscovery", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  it("with all three ports returns dataSourcesUsed including email, calendar, slack", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: stubAnalysis } as never);
    const slack = makeSlackPort();
    const deps: DiscoveryServiceDeps = {
      model: {} as never,
      email: makeEmailPort(),
      calendar: makeCalendarPort(),
      slack: slack.port,
      logger: makeLogger(),
    };

    const result = await runDiscovery("user1", deps);

    expect(slack.spies.getTopDMPartners).toHaveBeenCalledOnce();
    expect(slack.spies.getActiveChannels).toHaveBeenCalledOnce();
    expect(slack.spies.getMessageSample).toHaveBeenCalledOnce();
    expect(result.dataSourcesUsed).toEqual(expect.arrayContaining(["email", "calendar", "slack"]));
    expect(result.roleSummary).toBe(stubAnalysis.roleSummary);
    expect(typeof result.analyzedAt).toBe("number");
  });

  it("with only email+calendar (slack omitted) does NOT call any Slack API and excludes 'slack' from dataSourcesUsed", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: stubAnalysis } as never);
    const slack = makeSlackPort();
    // Provide spies but do NOT pass the port through deps.
    const deps: DiscoveryServiceDeps = {
      model: {} as never,
      email: makeEmailPort(),
      calendar: makeCalendarPort(),
      logger: makeLogger(),
    };

    const result = await runDiscovery("user1", deps);

    expect(slack.spies.getTopDMPartners).not.toHaveBeenCalled();
    expect(slack.spies.getActiveChannels).not.toHaveBeenCalled();
    expect(slack.spies.getMessageSample).not.toHaveBeenCalled();
    expect(result.dataSourcesUsed).toEqual(expect.arrayContaining(["email", "calendar"]));
    expect(result.dataSourcesUsed).not.toContain("slack");

    // Result still type-checks as DiscoveryResult — assert key fields.
    expect(typeof result.roleSummary).toBe("string");
    expect(Array.isArray(result.orgRelationships)).toBe(true);
    expect(Array.isArray(result.responsibilities)).toBe(true);
    expect(typeof result.analyzedAt).toBe("number");
  });

  it("with no ports returns a graceful empty DiscoveryResult and does NOT invoke generateObject", async () => {
    const logger = makeLogger();
    const deps: DiscoveryServiceDeps = {
      model: {} as never,
      logger,
    };

    const result = await runDiscovery("user1", deps);

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(result.orgRelationships).toEqual([]);
    expect(result.responsibilities).toEqual([]);
    expect(result.dataSourcesUsed).toEqual([]);
    // roleSummary signals 'no data'
    expect(result.roleSummary.toLowerCase()).toContain("no");
  });

  it("system prompt contains the directive section headers", async () => {
    // Capture the system prompt passed into generateObject.
    mockGenerateObject.mockResolvedValueOnce({ object: stubAnalysis } as never);
    const deps: DiscoveryServiceDeps = {
      model: {} as never,
      email: makeEmailPort(),
      logger: makeLogger(),
    };

    await runDiscovery("user1", deps);

    expect(mockGenerateObject).toHaveBeenCalledOnce();
    const call = mockGenerateObject.mock.calls[0]?.[0] as { system?: string } | undefined;
    const system = call?.system ?? "";
    for (const header of [
      "IDENTITY:",
      "ORG RELATIONSHIPS:",
      "RESPONSIBILITIES:",
      "COMMUNICATION STYLE:",
      "WORK PATTERNS:",
      "PAIN POINTS:",
      "SUGGESTIONS:",
    ]) {
      expect(system).toContain(header);
    }
  });
});
