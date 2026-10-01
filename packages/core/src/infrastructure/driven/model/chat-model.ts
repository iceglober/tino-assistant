/**
 * Wraps any AI-SDK LanguageModel as a ChatModel port. This is the one place the
 * agent loop lives — `reply()` runs a turn with a bounded multi-step tool loop
 * and returns the text plus the messages to append to history. Every provider
 * adapter funnels through here, so the loop is written once.
 */
import { generateText, type LanguageModel, type ModelMessage, stepCountIs, type ToolSet } from "ai";
import type { ChatModel } from "../../../ports/outbound.js";
import { describeModelMessage } from "./describe-message.js";
import { replayableHistory } from "./replayable-history.js";

export function toChatModel(model: LanguageModel): ChatModel {
  return {
    async reply(input) {
      const userMsg: ModelMessage = { role: "user", content: input.userText };
      const messages = [...replayableHistory(input.history as ModelMessage[]), userMsg];

      const result = await generateText({
        model,
        system: input.system,
        messages,
        tools: (input.tools as ToolSet) ?? {},
        stopWhen: stepCountIs(10),
      });

      return { text: result.text, newMessages: [userMsg, ...result.response.messages] };
    },

    describe: describeModelMessage,
  };
}
