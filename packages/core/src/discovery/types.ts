import { z } from "zod";

// --- Identity ---
export interface DiscoveryResult {
  roleSummary: string;
  inferredTitle: string;
  inferredDepartment: string;

  // --- Org graph ---
  orgRelationships: OrgRelationship[];

  // --- Responsibilities ---
  responsibilities: Responsibility[];

  // --- Communication profile ---
  communicationStyle: CommunicationStyle;

  // --- Work patterns ---
  workPatterns: WorkPatterns;

  // --- Pain points & suggestions ---
  painPoints: string[];
  suggestions: Suggestion[];

  // --- Metadata ---
  analyzedAt: number;
  dataSourcesUsed: string[];
}

export interface OrgRelationship {
  name: string;
  email?: string;
  relationship:
    | "reports-to"
    | "direct-report"
    | "peer"
    | "stakeholder"
    | "cross-functional"
    | "external"
    | "frequent-contact";
  context: string;
  interactionFrequency: string;
}

export interface Responsibility {
  title: string;
  description: string;
  timeHorizon: "daily" | "weekly" | "monthly" | "quarterly" | "ongoing";
  evidence: string;
}

export interface CommunicationStyle {
  summary: string;
  preferredChannels: string[];
  patterns: string[];
}

export interface WorkPatterns {
  meetingLoad: string;
  peakHours: string;
  recurringCommitments: string[];
  timeInvestment: TimeInvestment[];
}

export interface TimeInvestment {
  category: string;
  estimatedPct: number;
  details: string;
}

export interface Suggestion {
  title: string;
  description: string;
  capabilityId?: string;
}

export interface DiscoveryProgress {
  phase: "email" | "calendar" | "slack" | "analysis" | "done";
  pct: number;
  message: string;
}

export const DiscoveryAnalysisSchema = z.object({
  roleSummary: z.string().describe("2-3 sentences. Title, org, primary function."),
  inferredTitle: z.string().describe("Inferred job title, e.g. 'CTO', 'Senior Engineer', 'Product Manager'"),
  inferredDepartment: z.string().describe("Inferred department, e.g. 'Engineering', 'Product', 'Operations'"),

  orgRelationships: z
    .array(
      z.object({
        name: z.string().describe("Display name or email"),
        email: z.string().optional().describe("Email address if known"),
        relationship: z
          .enum([
            "reports-to",
            "direct-report",
            "peer",
            "stakeholder",
            "cross-functional",
            "external",
            "frequent-contact",
          ])
          .describe("Type of org relationship"),
        context: z.string().describe("How they interact, e.g. 'weekly 1:1, co-authors PRs, reviews your docs'"),
        interactionFrequency: z.string().describe("How often: daily, weekly, monthly, occasional"),
      }),
    )
    .describe("People in the user's org graph with relationship types"),

  responsibilities: z
    .array(
      z.object({
        title: z.string().describe("Short name for this responsibility"),
        description: z.string().describe("What this responsibility involves"),
        timeHorizon: z
          .enum(["daily", "weekly", "monthly", "quarterly", "ongoing"])
          .describe("Time horizon for this responsibility"),
        evidence: z.string().describe("What data point(s) support this inference"),
      }),
    )
    .describe("The user's responsibilities grouped by time horizon"),

  communicationStyle: z
    .object({
      summary: z.string().describe("2-3 sentences on how they communicate"),
      preferredChannels: z.array(z.string()).describe("Preferred channels, e.g. ['slack', 'email', 'meetings']"),
      patterns: z
        .array(z.string())
        .describe("Observable patterns, e.g. ['responds quickly to DMs', 'batches email replies']"),
    })
    .describe("The user's communication style derived from data"),

  workPatterns: z
    .object({
      meetingLoad: z.string().describe("Meeting load description, e.g. 'heavy (20+ hrs/week)', 'moderate', 'light'"),
      peakHours: z.string().describe("When they're most active, e.g. 'mornings', 'afternoons', 'distributed'"),
      recurringCommitments: z
        .array(z.string())
        .describe("Recurring commitments, e.g. 'daily standup 9am', 'weekly 1:1 with CTO'"),
      timeInvestment: z
        .array(
          z.object({
            category: z.string().describe("Category, e.g. 'meetings', 'code review', 'email', 'Slack'"),
            estimatedPct: z.number().describe("Estimated percentage 0-100"),
            details: z.string().describe("Supporting details"),
          }),
        )
        .describe("Estimated time split across categories"),
    })
    .describe("The user's work patterns"),

  painPoints: z.array(z.string()).describe("Observed inefficiencies, bottlenecks, or friction points"),

  suggestions: z
    .array(
      z.object({
        title: z.string().describe("Short actionable suggestion"),
        description: z.string().describe("Why this would help"),
        capabilityId: z.string().optional().describe("Related capability ID if applicable"),
      }),
    )
    .describe("Ways the assistant could help based on the user's role"),
});
