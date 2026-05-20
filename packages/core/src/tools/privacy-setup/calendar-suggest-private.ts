import { jsonSchema, type ToolSet } from "ai";

const PRIVACY_REGEX = /private|personal|hr|legal|medical|doctor|therapy|family|finance|tax/i;

export function calendarSuggestPrivateTool(deps: {
  getRecentEvents: (userId: string, daysBack: number) => Promise<Array<{ eventId: string; title: string; attendees?: string[] }>>;
}): ToolSet {
  return {
    calendar_suggest_private: {
      description: "Scan recent calendar events and suggest ones that might be private. Read-only.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          daysBack: { type: "number", description: "How many days back to scan (default: 30)" },
        },
      }),
      execute: async (input: { daysBack?: number }) => {
        const events = await deps.getRecentEvents("", input.daysBack ?? 30);
        const suggestions = events
          .filter((e) => PRIVACY_REGEX.test(e.title) || e.attendees?.some((a) => PRIVACY_REGEX.test(a)))
          .map((e) => ({
            eventId: e.eventId,
            title: e.title,
            reason: PRIVACY_REGEX.test(e.title) ? "title matches privacy keywords" : "attendee matches privacy keywords",
          }));
        return { suggestions };
      },
    },
  };
}
