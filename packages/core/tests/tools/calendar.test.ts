import type { calendar_v3 } from "googleapis";
import { describe, expect, it, vi } from "vitest";
import { _executeCalendarListEvents } from "../../src/tools/google/calendar.js";

// ---------------------------------------------------------------------------
// Mock helper
// ---------------------------------------------------------------------------

const makeCalendarClient = (listImpl: ReturnType<typeof vi.fn>) =>
  ({
    events: { list: listImpl },
  }) as unknown as calendar_v3.Calendar;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const timedEvent: calendar_v3.Schema$Event = {
  summary: "Team standup",
  start: { dateTime: "2026-05-13T09:00:00-05:00" },
  end: { dateTime: "2026-05-13T09:30:00-05:00" },
  location: "Zoom",
  attendees: [
    { email: "alice@example.com", responseStatus: "accepted", displayName: "Alice", self: true },
    { email: "bob@example.com", responseStatus: "needsAction", displayName: "Bob" },
  ],
};

const allDayEvent: calendar_v3.Schema$Event = {
  summary: "Company holiday",
  start: { date: "2026-05-13" },
  end: { date: "2026-05-14" },
};

const baseInput = {
  calendarId: "primary",
  timeMinIso: "2026-05-13T00:00:00-05:00",
  timeMaxIso: "2026-05-14T00:00:00-05:00",
  maxResults: 10,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("_executeCalendarListEvents", () => {
  // 1. Timed events normalized correctly
  it("normalizes timed events with allDay: false", async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: { items: [timedEvent, { ...timedEvent, summary: "Second meeting" }] },
    });
    const client = makeCalendarClient(listMock);

    const result = await _executeCalendarListEvents(client, baseInput);

    expect("events" in result).toBe(true);
    if (!("events" in result)) return;

    expect(result.count).toBe(2);
    expect(result.events[0]?.allDay).toBe(false);
    expect(result.events[0]?.start).toBe("2026-05-13T09:00:00-05:00");
    expect(result.events[0]?.end).toBe("2026-05-13T09:30:00-05:00");
    expect(result.events[0]?.summary).toBe("Team standup");
  });

  // 2. All-day events flagged
  it("flags all-day events with allDay: true and YYYY-MM-DD strings", async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: { items: [allDayEvent] },
    });
    const client = makeCalendarClient(listMock);

    const result = await _executeCalendarListEvents(client, baseInput);

    expect("events" in result).toBe(true);
    if (!("events" in result)) return;

    expect(result.events[0]?.allDay).toBe(true);
    expect(result.events[0]?.start).toBe("2026-05-13");
    expect(result.events[0]?.end).toBe("2026-05-14");
  });

  // 3. Mixed timed + all-day
  it("handles mixed timed and all-day events correctly", async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: { items: [timedEvent, allDayEvent] },
    });
    const client = makeCalendarClient(listMock);

    const result = await _executeCalendarListEvents(client, baseInput);

    expect("events" in result).toBe(true);
    if (!("events" in result)) return;

    expect(result.events[0]?.allDay).toBe(false);
    expect(result.events[1]?.allDay).toBe(true);
  });

  // 4. No title → "(no title)"
  it('uses "(no title)" when summary is undefined', async () => {
    const noTitleEvent: calendar_v3.Schema$Event = {
      start: { dateTime: "2026-05-13T10:00:00-05:00" },
      end: { dateTime: "2026-05-13T11:00:00-05:00" },
    };
    const listMock = vi.fn().mockResolvedValue({
      data: { items: [noTitleEvent] },
    });
    const client = makeCalendarClient(listMock);

    const result = await _executeCalendarListEvents(client, baseInput);

    expect("events" in result).toBe(true);
    if (!("events" in result)) return;

    expect(result.events[0]?.summary).toBe("(no title)");
  });

  // 5. Attendees normalized — only email + responseStatus
  it("normalizes attendees to only email and responseStatus", async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: { items: [timedEvent] },
    });
    const client = makeCalendarClient(listMock);

    const result = await _executeCalendarListEvents(client, baseInput);

    expect("events" in result).toBe(true);
    if (!("events" in result)) return;

    const attendees = result.events[0]!.attendees!;
    expect(attendees).toHaveLength(2);
    expect(attendees[0]).toEqual({ email: "alice@example.com", responseStatus: "accepted" });
    expect(attendees[1]).toEqual({ email: "bob@example.com", responseStatus: "needsAction" });
    // No displayName, self, organizer fields
    expect("displayName" in attendees[0]!).toBe(false);
    expect("self" in attendees[0]!).toBe(false);
  });

  // 6. No attendees → undefined
  it("returns undefined attendees when event has no attendees field", async () => {
    const listMock = vi.fn().mockResolvedValue({
      data: { items: [allDayEvent] },
    });
    const client = makeCalendarClient(listMock);

    const result = await _executeCalendarListEvents(client, baseInput);

    expect("events" in result).toBe(true);
    if (!("events" in result)) return;

    expect(result.events[0]?.attendees).toBeUndefined();
  });

  // 7. maxResults passed through to events.list
  it("passes maxResults through to the calendar API", async () => {
    const listMock = vi.fn().mockResolvedValue({ data: { items: [] } });
    const client = makeCalendarClient(listMock);

    await _executeCalendarListEvents(client, { ...baseInput, maxResults: 25 });

    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 25 }));
  });

  // 8. Auth error (401) → structured error
  it("returns auth_error on 401", async () => {
    const listMock = vi.fn().mockRejectedValue({ code: 401, message: "invalid_grant" });
    const client = makeCalendarClient(listMock);

    const result = await _executeCalendarListEvents(client, baseInput);

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;

    expect(result.error).toBe("auth_error");
    expect(result.message).toContain("401");
    expect(result.message).toContain("invalid_grant");
  });

  // 9. Calendar not found (404) → structured error
  it("returns calendar_not_found on 404", async () => {
    const listMock = vi.fn().mockRejectedValue({ code: 404 });
    const client = makeCalendarClient(listMock);

    const result = await _executeCalendarListEvents(client, {
      ...baseInput,
      calendarId: "nonexistent@group.calendar.google.com",
    });

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;

    expect(result.error).toBe("calendar_not_found");
    expect(result.message).toContain("nonexistent@group.calendar.google.com");
  });
});
