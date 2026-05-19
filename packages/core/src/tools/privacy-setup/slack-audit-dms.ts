import type { ToolSet } from "ai";

const PRIVACY_REGEX = /private|personal|hr|legal|medical|doctor|therapy|family|finance|tax/i;

export function slackAuditDmsTool(deps: {
  getRecentDms: (userId: string, daysBack: number) => Promise<Array<{ conversationId: string; participantName: string; messageCount: number }>>;
  denyListedUserIds: string[];
}): ToolSet {
  return {
    slack_audit_dms: {
      description: "List recent DM conversations and flag ones that look privacy-relevant but aren't deny-listed yet. Read-only.",
      parameters: {
        type: "object" as const,
        properties: {
          daysBack: { type: "number", description: "How many days back to scan (default: 30)" },
        },
      },
      execute: async (input: { daysBack?: number }) => {
        const dms = await deps.getRecentDms("", input.daysBack ?? 30);
        const denySet = new Set(deps.denyListedUserIds);
        const suggestions = dms
          .filter((dm) => PRIVACY_REGEX.test(dm.participantName) && !denySet.has(dm.conversationId))
          .map((dm) => ({
            conversationId: dm.conversationId,
            participantName: dm.participantName,
            reason: `"${dm.participantName}" matches privacy keywords but isn't in your deny-list`,
          }));
        return { suggestions };
      },
    },
  };
}
