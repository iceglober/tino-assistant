import { z } from "zod";

export const ScanSuggestionSchema = z.object({
  id: z.string(),
  sensitive: z.boolean(),
  reason: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ScanBatchResultSchema = z.object({
  items: z.array(ScanSuggestionSchema),
});

export type ScanSuggestion = z.infer<typeof ScanSuggestionSchema>;

export interface ScanResult {
  email?: {
    labels: ScanSuggestion[];
    contacts: ScanSuggestion[];
  };
  messaging?: {
    conversations: ScanSuggestion[];
  };
  scannedAt: number;
}

export interface ScanProgress {
  phase: "email-labels" | "email-contacts" | "messaging" | "done";
  pct: number;
  message: string;
}
