import type { ModelMessage } from "ai";
import type { AuditLogger } from "../audit/logger.js";
import type { HistoryStore } from "../agent/history.js";
import type { AppLogger } from "../slack/app.js";
import { evaluate, isPrivateCapability } from "./filter.js";
import type { PrivacyConfig, PrivacyConfigDelta } from "./types.js";

export interface ScrubResult {
  rowsScanned: number;
  rowsScrubbed: number;
  durationMs: number;
}

export async function runScrub(deps: {
  userId: string;
  addedRules: PrivacyConfigDelta;
  history: HistoryStore;
  config: PrivacyConfig;
  auditLogger?: AuditLogger;
  logger: AppLogger;
}): Promise<ScrubResult> {
  const { userId, history, config, auditLogger, logger } = deps;
  const start = Date.now();

  const messages = await history.get(userId);

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

  let rowsScanned = 0;
  let rowsScrubbed = 0;

  const scrubbed: ModelMessage[] = messages.map((msg) => {
    if (msg.role !== "tool") return msg;
    if (!Array.isArray(msg.content)) return msg;

    const filteredContent = msg.content.map((part) => {
      if (typeof part !== "object" || !("type" in part) || part.type !== "tool-result") return part;
      rowsScanned++;

      if (!isPrivateCapability(part.toolName)) return part;

      // Already scrubbed (placeholder) — skip
      if (typeof part.output === "object" && part.output !== null && "type" in part.output && (part.output as { type: string }).type === "redacted") {
        return part;
      }

      const callInfo = toolCallArgs.get(part.toolCallId);
      const decision = evaluate({
        toolName: part.toolName,
        toolArgs: callInfo?.input ?? {},
        toolResult: part.output,
        config,
      });

      if (decision.persist) return part;

      rowsScrubbed++;
      return { ...part, output: decision.placeholder };
    });

    return { ...msg, content: filteredContent };
  });

  if (rowsScrubbed > 0) {
    await history.reset(userId);
    await history.append(userId, scrubbed);
  }

  const durationMs = Date.now() - start;

  if (auditLogger) {
    await auditLogger.log({
      userId,
      action: "privacy_scrub",
      status: "success",
      durationMs,
      metadata: { rowsScanned, rowsScrubbed },
    });
  }

  logger.info({ userId, rowsScanned, rowsScrubbed, durationMs }, "privacy scrub complete");

  return { rowsScanned, rowsScrubbed, durationMs };
}
