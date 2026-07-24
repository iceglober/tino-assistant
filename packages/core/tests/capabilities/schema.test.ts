/**
 * Unit tests for the capability schema helpers — round-tripping between the
 * console-facing `{ id, fields, enabled }` view and the on-disk
 * `CapabilityConfig` blob.
 */
import { describe, expect, it } from "vitest";
import { cloudwatchCapability } from "../../src/capabilities/cloudwatch.js";
import { githubCapability } from "../../src/capabilities/github.js";
import { buildCapabilityView, buildConfigFromPayload, findCapability } from "../../src/capabilities/schema.js";
import type { CapabilityConfig } from "../../src/capabilities/types.js";

describe("buildCapabilityView", () => {
  it("returns one field per declared schema entry, with empty value when unconfigured", () => {
    const view = buildCapabilityView(githubCapability, null, undefined);
    expect(view.id).toBe("github");
    expect(view.enabled).toBe(false);
    expect(view.fields.map((f) => f.key).sort()).toEqual([
      "appId",
      "clientId",
      "clientSecret",
      "installationId",
      "privateKey",
    ]);
    for (const f of view.fields) expect(f.value).toBe("");
  });

  it("hydrates field values from credentials and settings", () => {
    const stored: CapabilityConfig = {
      enabled: true,
      credentials: { clientId: "Iv1.abc123", clientSecret: "secret_xyz" },
      settings: {},
    };
    const view = buildCapabilityView(githubCapability, stored, 1234);
    expect(view.enabled).toBe(true);
    expect(view.updatedAt).toBe(1234);
    const idField = view.fields.find((f) => f.key === "clientId");
    expect(idField?.value).toBe("Iv1.abc123");
    const secretField = view.fields.find((f) => f.key === "clientSecret");
    // Secret values are never echoed to the client — only whether one is set.
    expect(secretField?.value).toBe("");
    expect(secretField?.hasValue).toBe(true);
    expect(secretField?.secret).toBe(true);
  });

  it("reports hasValue=false for an unset secret field", () => {
    const view = buildCapabilityView(githubCapability, { enabled: true, credentials: {}, settings: {} }, undefined);
    const secretField = view.fields.find((f) => f.key === "clientSecret");
    expect(secretField?.value).toBe("");
    expect(secretField?.hasValue).toBe(false);
  });
});

describe("buildConfigFromPayload", () => {
  it("reconstructs a CapabilityConfig from the schema-driven fields payload", () => {
    const payload = {
      enabled: true,
      fields: [
        { key: "clientId", value: "Iv1.abc123" },
        { key: "clientSecret", value: "secret_xyz" },
      ],
    };
    const next = buildConfigFromPayload(githubCapability, payload, null);
    expect(next.enabled).toBe(true);
    expect(next.credentials.clientId).toBe("Iv1.abc123");
    expect(next.credentials.clientSecret).toBe("secret_xyz");
  });

  it("drops empty values rather than writing empty strings", () => {
    const next = buildConfigFromPayload(
      githubCapability,
      { enabled: false, fields: [{ key: "clientId", value: "" }] },
      null,
    );
    expect(next.credentials).not.toHaveProperty("clientId");
  });

  it("preserves an existing secret when an empty value is submitted (unchanged secret)", () => {
    const existing: CapabilityConfig = {
      enabled: true,
      credentials: { clientSecret: "kept_secret" },
      settings: {},
    };
    const next = buildConfigFromPayload(
      githubCapability,
      { enabled: true, fields: [{ key: "clientSecret", value: "" }] },
      existing,
    );
    // A secret is never echoed, so an empty submission means "unchanged" — keep it.
    expect(next.credentials.clientSecret).toBe("kept_secret");
  });

  it("replaces an existing secret when a new non-empty value is submitted", () => {
    const existing: CapabilityConfig = { enabled: true, credentials: { clientSecret: "old" }, settings: {} };
    const next = buildConfigFromPayload(
      githubCapability,
      { enabled: true, fields: [{ key: "clientSecret", value: "new" }] },
      existing,
    );
    expect(next.credentials.clientSecret).toBe("new");
  });

  it("preserves unknown keys (e.g. findWork, awsProfile) from the existing blob", () => {
    const existing: CapabilityConfig = {
      enabled: true,
      credentials: {},
      settings: { awsProfile: "dev", logGroups: ["/aws/foo"] },
      findWork: { enabled: true, intervalMinutes: 30 },
    };
    const next = buildConfigFromPayload(
      cloudwatchCapability,
      { enabled: true, fields: [{ key: "logGroups", value: "/aws/bar" }] },
      existing,
    );
    expect(next.settings.awsProfile).toBe("dev");
    expect(next.settings.logGroups).toEqual(["/aws/bar"]);
    expect(next.findWork?.enabled).toBe(true);
    expect(next.findWork?.intervalMinutes).toBe(30);
  });

  it("passes through legacy raw {credentials, settings} blob shape", () => {
    const next = buildConfigFromPayload(
      githubCapability,
      {
        enabled: true,
        credentials: { clientId: "Iv1.legacy", clientSecret: "sec_legacy" },
        settings: {},
      },
      null,
    );
    expect(next.credentials.clientId).toBe("Iv1.legacy");
    expect(next.credentials.clientSecret).toBe("sec_legacy");
  });
});

describe("findCapability", () => {
  it("finds known capabilities by id", () => {
    expect(findCapability("github")?.id).toBe("github");
    expect(findCapability("cloudwatch")?.id).toBe("cloudwatch");
  });
  it("returns null for unknown ids", () => {
    expect(findCapability("nope")).toBeNull();
  });
});
