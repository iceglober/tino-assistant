import { generateText, type LanguageModel, stepCountIs, type ToolSet } from "ai";
import type { AuditLogger } from "../audit/logger.js";
import { resolveInstructionsForUser } from "../instructions/loader.js";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import type { HistoryAppender } from "./history-appender.js";
import type { HistoryStore } from "./history.js";
import { logToolResult } from "../logging/redaction.js";
import { validateAgentOutput } from "./output-validator.js";
import { buildSystemPrompt } from "./systemPrompt.js";

export interface RunAgentParams {
  model: LanguageModel;
  history: HistoryStore;
  historyAppender?: HistoryAppender; // seam for privacy-filtering tool results
  logger: AppLogger;
  tools?: ToolSet; // empty/undefined in Phase 3
  userId: string;
  text: string;
  auditLogger?: AuditLogger;
  /** Active capability IDs for this user — used by the output validator. */
  activeCapabilities?: string[];
  /** Config store for loading instructions. When absent, instructions are skipped. */
  configStore?: ConfigStore;
}

/**
 * Send a user's DM through the agent loop and return the assistant's reply.
 *
 * Behavior:
 * - Appends the user message to history before the call.
 * - Passes the full history to `generateText` along with system prompt and tools.
 * - `stopWhen: stepCountIs(10)` caps multi-step tool loops at 10 turns.
 * - Appends `result.response.messages` (the model's new messages, including
 *   any tool calls/results) to history after the call.
 * - Logs an audit entry for each tool call in result.steps (if auditLogger provided).
 * - Runs output validation before returning; if flagged, returns a safe message
 *   and logs a denied audit entry.
 * - Returns `result.text` if non-empty, otherwise a placeholder string. Claude
 *   sometimes ends a multi-step run on a tool call with no follow-up text;
 *   the placeholder makes that case visible to the user instead of posting an
 *   empty Slack message (which Bolt rejects).
 */
export async function runAgent(params: RunAgentParams): Promise<string> {
  const { model, history, historyAppender, logger, tools, userId, text, auditLogger, activeCapabilities = [], configStore } = params;

  await history.append(userId, [{ role: "user", content: text }]);

  const instructions = configStore
    ? await resolveInstructionsForUser({ tinoUserId: userId, configStore })
    : undefined;

  const start = Date.now();
  const result = await generateText({
    model,
    system: buildSystemPrompt({ activeCapabilities, toolNames: Object.keys(tools ?? {}), instructions }),
    messages: await history.get(userId),
    tools: tools ?? {},
    stopWhen: stepCountIs(10),
  });
  const durationMs = Date.now() - start;

  if (historyAppender) {
    await historyAppender.append(userId, result.response.messages);
  } else {
    await history.append(userId, result.response.messages);
  }

  // ── Audit: log each tool call ─────────────────────────────────────────────
  if (auditLogger) {
    for (const step of result.steps) {
      for (const toolCall of step.toolCalls ?? []) {
        const _toolStart = step.usage ? start : start; // best-effort; step timing not exposed
        await auditLogger.log({
          userId,
          action: "tool_call",
          toolName: toolCall.toolName,
          inputKeys: Object.keys(toolCall.input as Record<string, unknown>),
          durationMs,
          status: "success",
        });
      }
      for (const toolResult of step.toolResults ?? []) {
        logToolResult(logger, { toolName: toolResult.toolName }, toolResult.result);
      }
    }
  }

  logger.info(
    {
      user: userId,
      durationMs,
      steps: result.steps.length,
      finishReason: result.finishReason,
      usage: result.usage,
    },
    "agent run complete",
  );

  const responseText = result.text || "(no response)";

  // ── Output validation ─────────────────────────────────────────────────────
  const validation = validateAgentOutput(responseText, { userId, activeCapabilities });
  if (!validation.safe) {
    logger.warn({ userId, reason: validation.reason }, "agent output flagged by safety filter");

    if (auditLogger) {
      await auditLogger.log({
        userId,
        action: "injection_suspected",
        status: "denied",
        errorMessage: validation.reason,
      });
    }

    return "i generated a response but it was flagged by the safety filter. an admin has been notified.";
  }

  return responseText;
}
