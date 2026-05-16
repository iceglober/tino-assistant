/**
 * Wave 3 (v2.2) — § 3.2 capability module test for `gmail`.
 *
 * Verifies:
 *   - `registerTools()` with full Google OAuth credentials registers
 *     gmail_search and gmail_get_message.
 *   - `registerTools()` throws when any required credential field is missing.
 *
 * Mocks `googleapis` at module level (the source imports `google.auth.OAuth2`
 * from `googleapis`, not `google-auth-library`).
 */

import type { ToolSet } from "ai";
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
    // at registration time. Stub the factory so it returns a placeholder client.
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

describe("gmailCapability.registerTools", () => {
  it("registers gmail_search and gmail_get_message when given full credentials", async () => {
    const tools: ToolSet = {};
    await gmailCapability.registerTools(GOOD_CONFIG, makeConfigStore(), makeLogger(), tools);
    const registered = Object.keys(tools);
    expect(registered).toContain("gmail_search");
    expect(registered).toContain("gmail_get_message");
  });

  it("throws when credentials.refreshToken is missing", async () => {
    const tools: ToolSet = {};
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientId: "id", clientSecret: "secret" },
      settings: {},
    };
    await expect(gmailCapability.registerTools(partial, makeConfigStore(), makeLogger(), tools)).rejects.toThrow(
      /refreshToken/,
    );
  });

  it("throws when credentials.clientSecret is missing", async () => {
    const tools: ToolSet = {};
    const partial: CapabilityConfig = {
      enabled: true,
      credentials: { clientId: "id", refreshToken: "r" },
      settings: {},
    };
    await expect(gmailCapability.registerTools(partial, makeConfigStore(), makeLogger(), tools)).rejects.toThrow(
      /clientSecret/,
    );
  });
});
