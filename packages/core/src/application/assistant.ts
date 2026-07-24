/**
 * The assistant use-case. Pure orchestration over ports — it imports no SDK,
 * no framework, no infrastructure. Wire it with concrete adapters in bootstrap.
 */
import { buildSystemPrompt } from "../domain/prompt.js";
import type { Assistant } from "../ports/inbound.js";
import type { ChatModel, HistoryStore, Logger, ToolProvider, UserStore } from "../ports/outbound.js";

export interface AssistantDeps {
  model: ChatModel;
  tools: ToolProvider;
  history: HistoryStore;
  users: UserStore;
  logger: Logger;
}

export function createAssistant(deps: AssistantDeps): Assistant {
  const { model, tools, history, users, logger } = deps;

  return {
    async handleMessage(userId: string, text: string): Promise<string> {
      const start = Date.now();
      const [prior, toolset] = await Promise.all([history.get(userId), tools.forUser(userId)]);
      const system = buildSystemPrompt({ toolNames: tools.names(toolset) });

      const { text: reply, newMessages } = await model.reply({
        system,
        history: prior,
        userText: text,
        tools: toolset,
      });

      await history.append(userId, newMessages);
      logger.info({ user: userId, durationMs: Date.now() - start }, "assistant reply");

      // A run can end on a tool call with no follow-up text; the placeholder
      // avoids posting an empty message (which Slack rejects).
      return reply || "(no response)";
    },

    async reset(userId: string): Promise<boolean> {
      const user = await users.get(userId);
      if (!user || user.role !== "admin") return false;
      await history.reset(userId);
      logger.info({ user: userId }, "conversation history reset");
      return true;
    },
  };
}
