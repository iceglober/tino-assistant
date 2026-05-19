import type { ModelMessage } from "ai";
import type { PrivacyFilter } from "../agent/history-appender.js";
import { evaluate, isPrivateCapability } from "./filter.js";
import type { PrivacyConfig } from "./types.js";

export type PrivacyConfigGetter = (userId: string) => Promise<PrivacyConfig | null>;

export class SourceRespectingPrivacyFilter implements PrivacyFilter {
  constructor(
    private getConfig: PrivacyConfigGetter,
    private enabled: boolean = true,
  ) {}

  async filter(userId: string, messages: ModelMessage[]): Promise<ModelMessage[]> {
    if (!this.enabled) return messages;

    const config = await this.getConfig(userId);

    const toolCallArgs = new Map<string, { toolName: string; input: unknown }>();
    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (typeof part === "object" && "type" in part && part.type === "tool-call") {
            toolCallArgs.set(part.toolCallId, { toolName: part.toolName, input: part.input });
          }
        }
      }
    }

    return messages.map((msg) => {
      if (msg.role !== "tool") return msg;
      if (!Array.isArray(msg.content)) return msg;

      const filteredContent = msg.content.map((part) => {
        if (typeof part !== "object" || !("type" in part) || part.type !== "tool-result") return part;
        if (!isPrivateCapability(part.toolName)) return part;

        const callInfo = toolCallArgs.get(part.toolCallId);
        const decision = evaluate({
          toolName: part.toolName,
          toolArgs: callInfo?.input ?? {},
          toolResult: part.output,
          config,
        });

        if (decision.persist) return part;

        return {
          ...part,
          output: decision.placeholder,
        };
      });

      return { ...msg, content: filteredContent };
    });
  }
}
