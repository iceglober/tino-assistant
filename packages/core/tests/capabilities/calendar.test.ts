/**
 * Wave 3 (v2.2) — § 3.2 capability module test for `calendar`.
 *
 * Verifies:
 *   - `registerTools()` with full Google OAuth credentials registers the
 *     `calendar_list_events` tool.
 *   - `registerTools()` throws a credential-named error when any of
 *     clientId / clientSecret / refreshToken is missing.
 *
 * Mocks `googleapis` (not `google-auth-library`; the source imports
 * `google.auth.OAuth2` from `googleapis`) at module level so no live
 * OAuth client is created.
 */

import type { ToolSet } from "ai";
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
    // The calendar tool calls `google.calendar({version, auth})` at registration
    // time. Stub it so the call resolves to a placeholder client object.
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

describe("calendarCapability.registerTools", () => {
  it("registers calendar_list_events when given full Google OAuth credentials", async () => {
    const tools: ToolSet = {};
    await calendarCapability.registerTools(GOOD_CONFIG, makeConfigStore(), makeLogger(), tools);
    expect(Object.keys(tools)).toContain("calendar_list_events");
  });

  it("throws when credentials.refreshToken is missing", async () => {
    const tools: ToolSet = {};
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientId: "id", clientSecret: "secret" },
      settings: {},
    };
    await expect(calendarCapability.registerTools(partial, makeConfigStore(), makeLogger(), tools)).rejects.toThrow(
      /refreshToken/,
    );
    expect(Object.keys(tools)).toHaveLength(0);
  });

  it("throws when credentials.clientId is missing", async () => {
    const tools: ToolSet = {};
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientSecret: "s", refreshToken: "r" },
      settings: {},
    };
    await expect(calendarCapability.registerTools(partial, makeConfigStore(), makeLogger(), tools)).rejects.toThrow(
      /clientId/,
    );
  });
});
