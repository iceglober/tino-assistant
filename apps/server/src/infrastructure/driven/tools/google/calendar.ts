import { tool } from "ai";
import { type calendar_v3, google } from "googleapis";
import { z } from "zod";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const inputSchema = z.object({
  calendarId: z.string().default("primary").describe('Calendar ID. Defaults to "primary" (the user\'s main calendar).'),
  timeMinIso: z.string().min(1).describe('ISO-8601 start of the time range, e.g. "2026-05-13T00:00:00-05:00"'),
  timeMaxIso: z.string().min(1).describe('ISO-8601 end of the time range, e.g. "2026-05-14T00:00:00-05:00"'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum number of events to return (1–50, default 10)"),
});

type CalendarInput = z.infer<typeof inputSchema>;

interface NormalizedEvent {
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  attendees?: Array<{ email: string; responseStatus: string }>;
}

type CalendarResult = { events: NormalizedEvent[]; count: number } | { error: string; message: string };

/**
 * Normalize a Google Calendar event into the shape we return to the model.
 *
 * Key decisions:
 * - All-day events use `date` (YYYY-MM-DD); timed events use `dateTime` (ISO-8601).
 *   We flag `allDay: true` so Claude can format them differently.
 * - Event descriptions are NOT included — work calendars may contain PHI.
 * - Attendee list is included but capped to email + responseStatus only.
 */
function normalizeEvent(event: calendar_v3.Schema$Event): NormalizedEvent {
  const allDay = Boolean(event.start?.date);
  return {
    summary: event.summary ?? "(no title)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    allDay,
    location: event.location ?? undefined,
    attendees: event.attendees?.map((a) => ({
      email: a.email ?? "",
      responseStatus: a.responseStatus ?? "needsAction",
    })),
  };
}

/**
 * Core calendar logic, exported for unit testing.
 */
export async function _executeCalendarListEvents(
  calendarClient: calendar_v3.Calendar,
  input: CalendarInput,
): Promise<CalendarResult> {
  const { calendarId, timeMinIso, timeMaxIso, maxResults } = input;

  try {
    const res = await calendarClient.events.list({
      calendarId,
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      maxResults,
      singleEvents: true, // expand recurring events
      orderBy: "startTime",
    });

    const events = (res.data.items ?? []).map(normalizeEvent);
    return { events, count: events.length };
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 401 || e.code === 403) {
      return {
        error: "auth_error",
        message: `Google Calendar auth failed (${e.code}): ${e.message ?? "check refresh token"}`,
      };
    }
    if (e.code === 404) {
      return {
        error: "calendar_not_found",
        message: `Calendar "${calendarId}" not found`,
      };
    }
    return {
      error: "google_error",
      message: `Calendar API error: ${e.message ?? "unknown"}`,
    };
  }
}

export function calendarListEventsTool(auth: OAuth2Client) {
  const calendarClient = google.calendar({ version: "v3", auth });
  return tool({
    description:
      "List events from a Google Calendar within a time range. " +
      "Returns normalized events with summary, start/end times, location, and attendees. " +
      "All-day events are flagged with allDay: true. " +
      "Defaults to the user's primary calendar.",
    inputSchema,
    execute: (input) => _executeCalendarListEvents(calendarClient, input),
  });
}
