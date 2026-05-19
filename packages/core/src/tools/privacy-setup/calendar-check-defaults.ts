import type { ToolSet } from "ai";

export function calendarCheckDefaultsTool(deps: {
  getCalendarSettings: (userId: string) => Promise<{ defaultVisibility: string; calendars: Array<{ id: string; summary: string; defaultVisibility: string }> }>;
  gateAllByDefault: boolean;
}): ToolSet {
  return {
    calendar_check_defaults: {
      description: "Check calendar default visibility settings. Read-only.",
      parameters: { type: "object" as const, properties: {} },
      execute: async () => {
        const settings = await deps.getCalendarSettings("");
        const warnings: string[] = [];
        if (!deps.gateAllByDefault) {
          for (const cal of settings.calendars) {
            if (cal.defaultVisibility !== "private") {
              warnings.push(`Calendar "${cal.summary}" has default visibility "${cal.defaultVisibility}" — events without explicit visibility will be persisted.`);
            }
          }
        }
        return { ...settings, warnings };
      },
    },
  };
}
