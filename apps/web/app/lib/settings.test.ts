import type { SettingsView } from "@tino/contracts";
import { describe, expect, it } from "vitest";
import { diffSettings, hasChanges, numberError, providerSpecs, specsFor } from "./settings";

const view: SettingsView = {
  values: { "model.provider": "openai", "openai.model": "gpt-5.1", "kb.recencyWeight": 0.3 },
  secrets: { "openai.apiKey": true, "anthropic.apiKey": false },
};

describe("catalogue helpers", () => {
  it("filters by group and provider", () => {
    expect(specsFor("slack").map((s) => s.key)).toContain("slack.signingSecret");
    expect(providerSpecs("anthropic").map((s) => s.key)).toEqual(["anthropic.apiKey", "anthropic.model"]);
  });
});

describe("diffSettings", () => {
  const keys = ["model.provider", "openai.model", "openai.apiKey", "anthropic.apiKey", "kb.recencyWeight"];

  it("is empty when nothing changed", () => {
    const u = diffSettings(
      view,
      { "model.provider": "openai", "openai.model": "gpt-5.1", "kb.recencyWeight": "0.3" },
      keys,
    );
    expect(hasChanges(u)).toBe(false);
  });

  it("sends changed text, and null for cleared text", () => {
    const u = diffSettings(view, { "model.provider": "anthropic", "openai.model": "  " }, keys);
    expect(u.values).toEqual({ "model.provider": "anthropic", "openai.model": null });
  });

  it("treats secrets as write-only", () => {
    expect(diffSettings(view, {}, keys).values).toEqual({});
    expect(diffSettings(view, { "openai.apiKey": "" }, keys).values).toEqual({});
    expect(diffSettings(view, { "openai.apiKey": " sk-new " }, keys).values).toEqual({ "openai.apiKey": "sk-new" });
    expect(diffSettings(view, { "openai.apiKey": null }, keys).values).toEqual({ "openai.apiKey": null });
    // clearing a secret that isn't set is a no-op
    expect(diffSettings(view, { "anthropic.apiKey": null }, keys).values).toEqual({});
  });

  it("sends numbers as numbers", () => {
    expect(diffSettings(view, { "kb.recencyWeight": "0.5" }, keys).values).toEqual({ "kb.recencyWeight": 0.5 });
  });

  it("ignores keys outside the page", () => {
    expect(diffSettings(view, { "slack.clientId": "x" }, keys).values).toEqual({});
  });
});

describe("numberError", () => {
  it("validates ranges", () => {
    expect(numberError("kb.recencyWeight", "")).toBeNull();
    expect(numberError("kb.recencyWeight", "abc")).toMatch(/number/);
    expect(numberError("kb.recencyWeight", "1.5")).toMatch(/between 0 and 1/);
    expect(numberError("kb.recencyTauDays", "0")).toMatch(/positive/);
    expect(numberError("kb.recencyTauDays", "30")).toBeNull();
  });
});
