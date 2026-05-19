import type { ToolSet } from "ai";

export interface GmailFilter {
  id: string;
  criteria?: { from?: string; query?: string };
  actions?: { addLabel?: string; removeLabelIds?: string[] };
}

export interface AuditSuggestion {
  filterId?: string;
  suggestion: string;
}

export function gmailAuditFiltersTool(deps: {
  listFilters: (userId: string) => Promise<GmailFilter[]>;
  privacyLabels: string[];
}): ToolSet {
  return {
    gmail_audit_filters: {
      description: "Lists Gmail filters and suggests privacy-related improvements. Read-only.",
      parameters: { type: "object" as const, properties: {} },
      execute: async () => {
        const filters = await deps.listFilters("");
        const suggestions: AuditSuggestion[] = [];
        for (const label of deps.privacyLabels) {
          const hasFilter = filters.some((f) => f.actions?.addLabel === label);
          if (!hasFilter) {
            suggestions.push({
              suggestion: `Label "${label}" is in your privacy config but has no auto-apply filter. Messages only get this label when you apply it manually.`,
            });
          }
        }
        return { filters, suggestions };
      },
    },
  };
}
