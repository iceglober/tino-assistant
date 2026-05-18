/**
 * Wave 1 — capability module test for `calendar` (private).
 *
 * Verifies:
 *   - `buildToolsForUser()` with full Google OAuth credentials returns
 *     a toolset with calendar_list_events.
 *   - `buildToolsForUser()` returns null when config is null (not connected).
 *   - `buildToolsForUser()` returns null when any required credential is missing.
 *
 * Mocks `googleapis` (not `google-auth-library`; the source imports
 * `google.auth.OAuth2` from `googleapis`) at module level so no live
 * OAuth client is created.
 */

import { describe, expect, it, vi } from "vitest";
import { calendarCapability } from "../../src/capabilities/calendar.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import { makeConfigStore, makeLogger } from "./_helpers.js";

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class FakeOAuth2 {
        setCredentials(_creds: unknown): void {}
      },
    },
    // The calendar tool calls `google.calendar({version, auth})` at build time.
    // Stub it so the call resolves to a placeholder client object.
    calendar: () => ({}),
  },
}));

const GOOD_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: {
    clientId: "test-client-id",
    clientSecret: "test-secret",
    refreshToken: "test-refresh",
  },
  settings: { calendarId: "primary" },
};

describe("calendarCapability.buildToolsForUser", () => {
  it("returns tools with calendar_list_events when given full Google OAuth credentials", async () => {
    const tools = await calendarCapability.buildToolsForUser("user123", GOOD_CONFIG, makeConfigStore(), makeLogger());
    expect(tools).not.toBeNull();
    expect(Object.keys(tools!)).toContain("calendar_list_events");
  });

  it("returns null when config is null", async () => {
    const tools = await calendarCapability.buildToolsForUser("user123", null, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });

  it("returns null when credentials.refreshToken is missing", async () => {
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientId: "id", clientSecret: "secret" },
      settings: {},
    };
    const tools = await calendarCapability.buildToolsForUser("user123", partial, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });

  it("returns null when credentials.clientId is missing", async () => {
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientSecret: "s", refreshToken: "r" },
      settings: {},
    };
    const tools = await calendarCapability.buildToolsForUser("user123", partial, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });

  it("returns null when credentials.clientSecret is missing", async () => {
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientId: "id", refreshToken: "r" },
      settings: {},
    };
    const tools = await calendarCapability.buildToolsForUser("user123", partial, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });
});
