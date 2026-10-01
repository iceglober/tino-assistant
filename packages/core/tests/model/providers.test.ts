import { describe, expect, it } from "vitest";
import { buildChatModel, type ModelSettings, resolveModelConfig } from "../../src/infrastructure/driven/model/index.js";

const getter =
  (m: Record<string, string>) =>
  (k: string): string | undefined =>
    m[k];

describe("resolveModelConfig", () => {
  it("returns null when the selected provider is unconfigured", () => {
    expect(resolveModelConfig(getter({}))).toBeNull(); // defaults to azure, no keys
    expect(resolveModelConfig(getter({ "model.provider": "openai" }))).toBeNull();
    expect(resolveModelConfig(getter({ "model.provider": "bedrock" }))).toBeNull(); // unknown provider
  });

  it("azure requires key + deployment + (resourceName OR baseURL)", () => {
    expect(resolveModelConfig(getter({ "azure.apiKey": "k", "azure.deployment": "d" }))).toBeNull();
    expect(
      resolveModelConfig(getter({ "azure.apiKey": "k", "azure.deployment": "d", "azure.resourceName": "res" })),
    ).toMatchObject({ provider: "azure", deployment: "d", resourceName: "res" });
    expect(
      resolveModelConfig(getter({ "azure.apiKey": "k", "azure.deployment": "d", "azure.baseURL": "https://x" })),
    ).toMatchObject({ provider: "azure" });
  });

  it("resolves openai / anthropic", () => {
    expect(
      resolveModelConfig(getter({ "model.provider": "openai", "openai.apiKey": "k", "openai.model": "gpt-4o" })),
    ).toMatchObject({ provider: "openai", model: "gpt-4o" });
    expect(
      resolveModelConfig(getter({ "model.provider": "anthropic", "anthropic.apiKey": "k", "anthropic.model": "claude" })),
    ).toMatchObject({ provider: "anthropic", model: "claude" });
  });
});

describe("buildChatModel", () => {
  it("builds a ChatModel with a reply() for every provider (no network at construction)", () => {
    const settings: ModelSettings[] = [
      { provider: "azure", apiKey: "k", resourceName: "r", deployment: "d" },
      { provider: "openai", apiKey: "k", model: "gpt-4o" },
      { provider: "anthropic", apiKey: "k", model: "claude" },
    ];
    for (const s of settings) {
      expect(typeof buildChatModel(s).reply).toBe("function");
    }
  });
});
