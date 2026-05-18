/**
 * Wave 1 — capability module test for `gmail` (private).
 *
 * Verifies:
 *   - `buildToolsForUser()` with full Google OAuth credentials returns
 *     a toolset with gmail_search and gmail_get_message.
 *   - `buildToolsForUser()` returns null when config is null (not connected).
 *   - `buildToolsForUser()` returns null when any required credential is missing.
 *
 * Mocks `googleapis` at module level (the source imports `google.auth.OAuth2`
 * from `googleapis`, not `google-auth-library`).
 */

import { describe, expect, it, vi } from "vitest";
import { gmailCapability } from "../../src/capabilities/gmail.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";
import { makeConfigStore, makeLogger } from "./_helpers.js";

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class FakeOAuth2 {
        setCredentials(_creds: unknown): void {}
      },
    },
    // gmail_search and gmail_get_message both call `google.gmail({version, auth})`
    // at build time. Stub the factory so it returns a placeholder client.
    gmail: () => ({}),
  },
}));

const GOOD_CONFIG: CapabilityConfig = {
  enabled: true,
  credentials: {
    clientId: "id",
    clientSecret: "secret",
    refreshToken: "refresh",
  },
  settings: {},
};

describe("gmailCapability.buildToolsForUser", () => {
  it("returns tools with gmail_search and gmail_get_message when given full credentials", async () => {
    const tools = await gmailCapability.buildToolsForUser("user123", GOOD_CONFIG, makeConfigStore(), makeLogger());
    expect(tools).not.toBeNull();
    const keys = Object.keys(tools!);
    expect(keys).toContain("gmail_search");
    expect(keys).toContain("gmail_get_message");
  });

  it("returns null when config is null", async () => {
    const tools = await gmailCapability.buildToolsForUser("user123", null, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });

  it("returns null when credentials.refreshToken is missing", async () => {
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientId: "id", clientSecret: "secret" },
      settings: {},
    };
    const tools = await gmailCapability.buildToolsForUser("user123", partial, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });

  it("returns null when credentials.clientSecret is missing", async () => {
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientId: "id", refreshToken: "r" },
      settings: {},
    };
    const tools = await gmailCapability.buildToolsForUser("user123", partial, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });

  it("returns null when credentials.clientId is missing", async () => {
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientSecret: "secret", refreshToken: "r" },
      settings: {},
    };
    const tools = await gmailCapability.buildToolsForUser("user123", partial, makeConfigStore(), makeLogger());
    expect(tools).toBeNull();
  });
});
