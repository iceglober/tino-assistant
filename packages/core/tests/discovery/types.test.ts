/**
 * Proof tests for DiscoveryResult / DiscoveryAnalysisSchema (item 1a).
 *
 * Type-level proofs assert:
 *   - DiscoveryResult exposes the new structured fields (orgRelationships,
 *     responsibilities, communicationStyle, workPatterns, painPoints,
 *     suggestions, etc.).
 *   - Legacy fields `duties` and `contactCategories` are NOT part of
 *     DiscoveryResult — using them is a type error.
 *
 * Runtime proofs assert:
 *   - DiscoveryAnalysisSchema.parse() accepts an object containing all
 *     required new fields.
 *   - DiscoveryAnalysisSchema.parse() rejects an object missing
 *     orgRelationships.
 */
import { describe, expect, it } from "vitest";
import {
  DiscoveryAnalysisSchema,
  type CommunicationStyle,
  type DiscoveryResult,
  type OrgRelationship,
  type Responsibility,
  type Suggestion,
  type TimeInvestment,
  type WorkPatterns,
} from "../../src/discovery/types.ts";

// ---------------------------------------------------------------------------
// Type-level: imports above must all resolve. The block below demonstrates
// shape conformance — if any required field is missing or renamed in
// DiscoveryResult, the assignment fails type-check.
// ---------------------------------------------------------------------------
const _typeProof: DiscoveryResult = {
  roleSummary: "x",
  inferredTitle: "x",
  inferredDepartment: "x",
  orgRelationships: [] satisfies OrgRelationship[],
  responsibilities: [] satisfies Responsibility[],
  communicationStyle: {
    summary: "x",
    preferredChannels: [],
    patterns: [],
  } satisfies CommunicationStyle,
  workPatterns: {
    meetingLoad: "x",
    peakHours: "x",
    recurringCommitments: [],
    timeInvestment: [] satisfies TimeInvestment[],
  } satisfies WorkPatterns,
  painPoints: [],
  suggestions: [] satisfies Suggestion[],
  analyzedAt: 0,
  dataSourcesUsed: [],
};
void _typeProof;

// Legacy fields must NOT be assignable. `@ts-expect-error` itself fails the
// type-check if the error doesn't occur — i.e., if the legacy field sneaks
// back into DiscoveryResult, this file stops compiling.
const _legacyProof = (): DiscoveryResult => ({
  roleSummary: "x",
  inferredTitle: "x",
  inferredDepartment: "x",
  orgRelationships: [],
  responsibilities: [],
  communicationStyle: { summary: "x", preferredChannels: [], patterns: [] },
  workPatterns: {
    meetingLoad: "x",
    peakHours: "x",
    recurringCommitments: [],
    timeInvestment: [],
  },
  painPoints: [],
  suggestions: [],
  analyzedAt: 0,
  dataSourcesUsed: [],
  // @ts-expect-error — legacy field `duties` removed from DiscoveryResult.
  duties: [],
  // @ts-expect-error — legacy field `contactCategories` removed from DiscoveryResult.
  contactCategories: [],
});
void _legacyProof;

describe("DiscoveryAnalysisSchema", () => {
  const validInput = {
    roleSummary: "CTO at Iceglober.",
    inferredTitle: "CTO",
    inferredDepartment: "Engineering",
    orgRelationships: [
      {
        name: "Alex",
        email: "alex@example.com",
        relationship: "peer" as const,
        context: "co-author on PRs",
        interactionFrequency: "weekly",
      },
    ],
    responsibilities: [
      {
        title: "Architecture",
        description: "Owns platform architecture",
        timeHorizon: "ongoing" as const,
        evidence: "Frequent design-doc authorship",
      },
    ],
    communicationStyle: {
      summary: "Direct, async-first.",
      preferredChannels: ["slack"],
      patterns: ["batches email"],
    },
    workPatterns: {
      meetingLoad: "moderate",
      peakHours: "mornings",
      recurringCommitments: ["weekly 1:1 with CEO"],
      timeInvestment: [
        { category: "code review", estimatedPct: 25, details: "PRs" },
      ],
    },
    painPoints: ["context-switching"],
    suggestions: [
      { title: "Daily brief", description: "Summarize Slack overnight" },
    ],
  };

  it("accepts an object containing all required new fields", () => {
    const parsed = DiscoveryAnalysisSchema.parse(validInput);
    expect(parsed.orgRelationships).toHaveLength(1);
    expect(parsed.responsibilities).toHaveLength(1);
    expect(parsed.communicationStyle.summary).toBe("Direct, async-first.");
    expect(parsed.workPatterns.timeInvestment[0]?.estimatedPct).toBe(25);
  });

  it("rejects an object missing orgRelationships", () => {
    const { orgRelationships: _omit, ...missing } = validInput;
    void _omit;
    expect(() => DiscoveryAnalysisSchema.parse(missing)).toThrow();
  });
});
