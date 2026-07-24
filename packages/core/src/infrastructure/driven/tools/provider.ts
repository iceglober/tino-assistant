/**
 * The composite ToolProvider adapter: merges the shared Slack tools (built once)
 * with the signed-in user's per-user Google tools. Implements the ToolProvider
 * port; `Tools` is concretely an AI-SDK ToolSet here.
 */
import type { ToolSet } from "ai";
import type { ToolProvider, Tools } from "../../../ports/outbound.js";

export function createToolProvider(deps: {
  /** Shared Slack tools, built once at startup from the bot token. */
  slackTools: ToolSet;
  /** Build the per-user Google tools for a given user. */
  buildGoogle: (userId: string) => Promise<ToolSet>;
}): ToolProvider {
  return {
    async forUser(userId: string): Promise<Tools> {
      const google = await deps.buildGoogle(userId);
      return { ...deps.slackTools, ...google } satisfies ToolSet;
    },
    names(tools: Tools): string[] {
      return Object.keys(tools as ToolSet);
    },
  };
}
