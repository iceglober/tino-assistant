/**
 * The composite ToolProvider adapter: merges the shared Slack channel tools
 * (bot token, built once) with the signed-in user's per-user Google tools and
 * per-user Slack tools (their own OAuth token). Implements the ToolProvider
 * port; `Tools` is concretely an AI-SDK ToolSet here.
 */
import type { ToolSet } from "ai";
import type { ToolProvider, Tools } from "../../../ports/outbound.js";

export function createToolProvider(deps: {
  /** Shared Slack channel tools, built once at startup from the bot token. */
  slackTools: ToolSet;
  /** Build the per-user Google tools (Gmail + Calendar) for a given user. */
  buildGoogle: (userId: string) => Promise<ToolSet>;
  /** Build the per-user Slack tools (from the user's own OAuth token). */
  buildSlackUser: (userId: string) => Promise<ToolSet>;
  /** Build the knowledge-base search tools (empty when the KB is off/unpopulated). */
  buildKb?: (userId: string) => Promise<ToolSet>;
}): ToolProvider {
  return {
    async forUser(userId: string): Promise<Tools> {
      const [google, slackUser, kb] = await Promise.all([
        deps.buildGoogle(userId),
        deps.buildSlackUser(userId),
        deps.buildKb ? deps.buildKb(userId) : Promise.resolve({}),
      ]);
      return { ...deps.slackTools, ...google, ...slackUser, ...kb } satisfies ToolSet;
    },
    names(tools: Tools): string[] {
      return Object.keys(tools as ToolSet);
    },
  };
}
