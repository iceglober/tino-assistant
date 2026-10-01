import { describe, expect, it } from "vitest";
import { isSecretConfigKey, orgSlugProblem, slugify } from "../../src/domain/org.js";

describe("org slugs", () => {
  it("slugifies names", () => {
    expect(slugify("Acme, Inc.")).toBe("acme-inc");
    expect(slugify("Ünïcödé Labs")).toBe("unicode-labs");
    expect(slugify("X")).toBe("x-team");
  });

  it("rejects bad and reserved slugs", () => {
    expect(orgSlugProblem("acme")).toBeNull();
    expect(orgSlugProblem("ab")).not.toBeNull();
    expect(orgSlugProblem("-acme")).not.toBeNull();
    expect(orgSlugProblem("ac--me")).not.toBeNull();
    expect(orgSlugProblem("Acme")).not.toBeNull();
    expect(orgSlugProblem("api")).toBe("that name is reserved");
  });
});

describe("isSecretConfigKey", () => {
  it("classifies secrets by the last segment", () => {
    for (const k of [
      "slack.clientSecret",
      "slack.signingSecret",
      "slack.botToken",
      "openai.apiKey",
      "anthropic.apiKey",
    ]) {
      expect(isSecretConfigKey(k)).toBe(true);
    }
    for (const k of ["slack.clientId", "model.provider", "azure.resourceName", "kb.recencyWeight"]) {
      expect(isSecretConfigKey(k)).toBe(false);
    }
  });
});
