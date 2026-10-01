/**
 * The model provider registry. Each provider is a ChatModel adapter selected at
 * runtime from the `model.provider` config value the console Setup writes.
 *
 * All three ride the `@ai-sdk/provider@3.0.x` spec that `ai@6` speaks (the
 * provider packages version independently of `ai` — see package.json).
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ChatModel } from "@tino/core/ports/outbound";
import { toChatModel } from "./chat-model.js";

export type ModelProvider = "azure" | "openai" | "anthropic";

/** Validated, provider-specific model settings. */
export type ModelSettings =
  | { provider: "azure"; apiKey: string; resourceName?: string; baseURL?: string; deployment: string; apiVersion?: string }
  | { provider: "openai"; apiKey: string; model: string }
  | { provider: "anthropic"; apiKey: string; model: string };

/**
 * Read + validate model settings from a config-key getter. Returns null when the
 * selected provider's required fields aren't all present (model not configured).
 * `get` should read the console config store, falling back to env vars.
 */
export function resolveModelConfig(get: (key: string) => string | undefined): ModelSettings | null {
  const provider = (get("model.provider") ?? "azure") as ModelProvider;
  switch (provider) {
    case "azure": {
      const apiKey = get("azure.apiKey");
      const deployment = get("azure.deployment");
      const resourceName = get("azure.resourceName");
      const baseURL = get("azure.baseURL");
      if (apiKey && deployment && (resourceName || baseURL)) {
        return { provider, apiKey, deployment, resourceName, baseURL, apiVersion: get("azure.apiVersion") };
      }
      return null;
    }
    case "openai": {
      const apiKey = get("openai.apiKey");
      const model = get("openai.model");
      return apiKey && model ? { provider, apiKey, model } : null;
    }
    case "anthropic": {
      const apiKey = get("anthropic.apiKey");
      const model = get("anthropic.model");
      return apiKey && model ? { provider, apiKey, model } : null;
    }
    default:
      return null;
  }
}

/**
 * Construct the raw AI-SDK model. Exposed separately from `buildChatModel`
 * because knowledge extraction needs schema-constrained generation rather than
 * a conversational turn, and both must run on whatever provider is configured.
 */
export function buildLanguageModel(s: ModelSettings): LanguageModel {
  let model: LanguageModel;
  switch (s.provider) {
    case "azure": {
      const azure = createAzure({
        apiKey: s.apiKey,
        ...(s.baseURL ? { baseURL: s.baseURL } : { resourceName: s.resourceName }),
        ...(s.apiVersion ? { apiVersion: s.apiVersion } : {}),
      });
      model = azure(s.deployment);
      break;
    }
    case "openai":
      model = createOpenAI({ apiKey: s.apiKey })(s.model);
      break;
    case "anthropic":
      model = createAnthropic({ apiKey: s.apiKey })(s.model);
      break;
  }
  return model;
}

/** Construct the ChatModel for validated settings. */
export function buildChatModel(s: ModelSettings): ChatModel {
  return toChatModel(buildLanguageModel(s));
}
