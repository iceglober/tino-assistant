import type { ToolSet } from "ai";

export function gmailCreatePrivacyFilterTool(deps: {
  createFilter: (userId: string, opts: { from?: string; query?: string; addLabel: string }) => Promise<{ ok: boolean; filterId?: string; error?: string }>;
}): ToolSet {
  return {
    gmail_create_privacy_filter: {
      description: "Create a Gmail filter that auto-applies a label to matching messages. Requires explicit confirm: true.",
      parameters: {
        type: "object" as const,
        properties: {
          from: { type: "string", description: "Filter by sender address" },
          query: { type: "string", description: "Gmail search query to match" },
          addLabel: { type: "string", description: "Label to apply to matching messages" },
          confirm: { type: "boolean", description: "Must be true to proceed — this creates a real Gmail filter" },
        },
        required: ["addLabel", "confirm"],
      },
      execute: async (input: { from?: string; query?: string; addLabel: string; confirm?: boolean }, { toolCallId }: { toolCallId: string }) => {
        if (!input.confirm) {
          return { error: "Confirmation required. Set confirm: true to create this filter.", needsConfirm: true };
        }
        return deps.createFilter("", { from: input.from, query: input.query, addLabel: input.addLabel });
      },
    },
  };
}
