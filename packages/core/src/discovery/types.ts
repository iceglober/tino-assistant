import { z } from "zod";

export interface DiscoveryResult {
  roleSummary: string;
  duties: Duty[];
  contactCategories: ContactCategory[];
  suggestions: Suggestion[];
  analyzedAt: number;
}

export interface Duty {
  title: string;
  description: string;
  frequency?: string;
}

export interface ContactCategory {
  category: string;
  contacts: string[];
  description: string;
}

export interface Suggestion {
  title: string;
  description: string;
  capabilityId?: string;
}

export interface DiscoveryProgress {
  phase: "email" | "calendar" | "analysis" | "done";
  pct: number;
  message: string;
}

export const DiscoveryAnalysisSchema = z.object({
  roleSummary: z.string().describe("One-paragraph summary of the user's role and responsibilities"),
  duties: z.array(z.object({
    title: z.string().describe("Short name for this duty"),
    description: z.string().describe("What this duty involves"),
    frequency: z.string().optional().describe("How often: daily, weekly, monthly, ad-hoc"),
  })).describe("The user's recurring duties and responsibilities"),
  contactCategories: z.array(z.object({
    category: z.string().describe("Category name like 'Engineering team', 'External vendors', 'Leadership'"),
    contacts: z.array(z.string()).describe("Email addresses or names in this category"),
    description: z.string().describe("What this group represents"),
  })).describe("Groups of contacts by relationship type"),
  suggestions: z.array(z.object({
    title: z.string().describe("Short actionable suggestion"),
    description: z.string().describe("Why this would help"),
    capabilityId: z.string().optional().describe("Related capability ID if applicable"),
  })).describe("Ways the assistant could help based on the user's role"),
});
