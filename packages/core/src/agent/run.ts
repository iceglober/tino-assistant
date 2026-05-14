import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import type { HistoryStore } from './history.js';
import type { AppLogger } from '../slack/app.js';
import { buildSystemPrompt } from './systemPrompt.js';

export interface RunAgentParams {
  model: LanguageModel;
  history: HistoryStore;
  logger: AppLogger;
  tools?: ToolSet; // empty/undefined in Phase 3
  userId: string;
  text: string;
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
 * - Returns `result.text` if non-empty, otherwise a placeholder string. Claude
 *   sometimes ends a multi-step run on a tool call with no follow-up text;
 *   the placeholder makes that case visible to the user instead of posting an
 *   empty Slack message (which Bolt rejects).
 */
export async function runAgent(params: RunAgentParams): Promise<string> {
  const { model, history, logger, tools, userId, text } = params;

  await history.append(userId, [{ role: 'user', content: text }]);

  const start = Date.now();
  const result = await generateText({
    model,
    system: buildSystemPrompt(),
    messages: await history.get(userId),
    tools: tools ?? {},
    stopWhen: stepCountIs(10),
  });
  const durationMs = Date.now() - start;

  await history.append(userId, result.response.messages);

  logger.info(
    {
      user: userId,
      durationMs,
      steps: result.steps.length,
      finishReason: result.finishReason,
      usage: result.usage,
    },
    'agent run complete',
  );

  return result.text || '(no response)';
}
