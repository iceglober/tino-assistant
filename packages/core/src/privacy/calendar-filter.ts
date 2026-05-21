import type { CalendarPrivacyConfig, Decision } from "./types.js";

interface CalendarEvent {
  summary?: string;
  start?: string;
  end?: string;
  visibility?: "default" | "public" | "private" | "confidential";
}

interface CalendarToolResult {
  events?: CalendarEvent[];
  error?: string;
}

export function calendarFilter(
  _toolArgs: unknown,
  toolResult: unknown,
  config: CalendarPrivacyConfig | undefined,
): Decision {
  const result = toolResult as CalendarToolResult;
  if (!result.events || result.error) return { persist: true };
  if (!config) return { persist: true };

  if (config.gateAllByDefault) {
    const first = result.events[0];
    return {
      persist: false,
      placeholder: {
        type: "redacted",
        reason: "private_event",
        metadata: {
          startsAt: first?.start,
          endsAt: first?.end,
        },
      },
    };
  }

  for (const event of result.events) {
    const vis = event.visibility ?? "default";

    if (vis === "private" || vis === "confidential") {
      return {
        persist: false,
        placeholder: {
          type: "redacted",
          reason: "private_event",
          metadata: { startsAt: event.start, endsAt: event.end },
        },
      };
    }

    if (vis === "default" && config.defaultVisibility === "private") {
      return {
        persist: false,
        placeholder: {
          type: "redacted",
          reason: "private_event",
          metadata: { startsAt: event.start, endsAt: event.end },
        },
      };
    }
  }

  return { persist: true };
}
