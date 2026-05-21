import { describe, expect, it } from "vitest";
import { calendarFilter } from "../../src/privacy/calendar-filter.js";
import type { CalendarPrivacyConfig } from "../../src/privacy/types.js";

const baseConfig: CalendarPrivacyConfig = {
  defaultVisibility: "public",
  gateAllByDefault: false,
};

describe("calendar privacy filter", () => {
  it("private visibility gates", () => {
    const result = calendarFilter(
      {},
      { events: [{ summary: "Therapy", start: "2026-05-19T14:00:00", visibility: "private" }] },
      baseConfig,
    );
    expect(result.persist).toBe(false);
    if (!result.persist) {
      expect(result.placeholder.reason).toBe("private_event");
      expect(result.placeholder.metadata.startsAt).toBe("2026-05-19T14:00:00");
    }
  });

  it("confidential visibility gates", () => {
    const result = calendarFilter(
      {},
      { events: [{ summary: "Board meeting", start: "2026-05-19T10:00:00", visibility: "confidential" }] },
      baseConfig,
    );
    expect(result.persist).toBe(false);
  });

  it("default visibility with private calendar default gates", () => {
    const config: CalendarPrivacyConfig = { defaultVisibility: "private", gateAllByDefault: false };
    const result = calendarFilter(
      {},
      { events: [{ summary: "Standup", start: "2026-05-19T09:00:00", visibility: "default" }] },
      config,
    );
    expect(result.persist).toBe(false);
  });

  it("default visibility with public calendar default persists", () => {
    const result = calendarFilter(
      {},
      { events: [{ summary: "Standup", start: "2026-05-19T09:00:00", visibility: "default" }] },
      baseConfig,
    );
    expect(result.persist).toBe(true);
  });

  it("public visibility persists", () => {
    const result = calendarFilter(
      {},
      { events: [{ summary: "All-hands", start: "2026-05-19T11:00:00", visibility: "public" }] },
      baseConfig,
    );
    expect(result.persist).toBe(true);
  });

  it("gateAllByDefault gates regardless of source visibility", () => {
    const config: CalendarPrivacyConfig = { defaultVisibility: "public", gateAllByDefault: true };
    const result = calendarFilter(
      {},
      { events: [{ summary: "All-hands", start: "2026-05-19T11:00:00", visibility: "public" }] },
      config,
    );
    expect(result.persist).toBe(false);
  });

  it("no config means persist (default-allow)", () => {
    const result = calendarFilter(
      {},
      { events: [{ summary: "Therapy", start: "2026-05-19T14:00:00", visibility: "private" }] },
      undefined,
    );
    expect(result.persist).toBe(true);
  });

  it("error result persists (pass-through)", () => {
    const result = calendarFilter({}, { error: "auth failed" }, baseConfig);
    expect(result.persist).toBe(true);
  });
});
