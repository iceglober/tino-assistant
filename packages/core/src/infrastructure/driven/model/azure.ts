/**
 * Azure OpenAI adapter for the ChatModel port. This is the ONLY place the `ai`
 * SDK's agent loop lives — `reply()` runs one turn (with a bounded multi-step
 * tool loop) and hands back the reply text plus the messages to append.
 */
import { createAzure } from "@ai-sdk/azure";
import { generateText, type LanguageModel, type ModelMessage, stepCountIs, type ToolSet } from "ai";
import type { ChatModel } from "../../../ports/outbound.js";

export interface AzureModelConfig {
  resourceName?: string;
  baseURL?: string;
  apiKey: string;
  deployment: string;
  apiVersion?: string;
}

/** Build a ChatModel backed by an Azure OpenAI deployment. */
export function createAzureChatModel(cfg: AzureModelConfig): ChatModel {
  const azure = createAzure({
    apiKey: cfg.apiKey,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : { resourceName: cfg.resourceName }),
    ...(cfg.apiVersion ? { apiVersion: cfg.apiVersion } : {}),
  });
  const model: LanguageModel = azure(cfg.deployment);

  return {
    async reply(input) {
      const userMsg: ModelMessage = { role: "user", content: input.userText };
      const messages = [...(input.history as ModelMessage[]), userMsg];

      const result = await generateText({
        model,
        system: input.system,
        messages,
        tools: (input.tools as ToolSet) ?? {},
        stopWhen: stepCountIs(10),
      });

      return { text: result.text, newMessages: [userMsg, ...result.response.messages] };
    },
  };
}
