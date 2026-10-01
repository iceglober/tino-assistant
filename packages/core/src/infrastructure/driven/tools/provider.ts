/**
 * The ToolProvider adapter. Tools come in groups, and each group says who may
 * see what its tools return. For each reply, only the groups whose results the
 * readers may see are built — a Gmail tool is never even constructed for a
 * channel reply. The provider also reports who may see a reply built from the
 * groups it used, so the conversation log can label it.
 */
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import {
  everyoneInWorkspace,
  membersOfChannel,
  onlyUser,
  readersMaySee,
  strictestOf,
  type WhoCanSee,
} from "../../../domain/who-can-see.js";
import type { Logger, ToolProvider, ToolRequest, Tools } from "../../../ports/outbound.js";
import type { SlackChannelTools } from "./slack.js";

export interface ToolGroup {
  /** For logs: which group this is. */
  name: string;
  whoCanSeeResults: WhoCanSee;
  build(): Promise<ToolSet>;
}

export interface ToolSources {
  /** Bot-token Slack tools. A getter: Setup can replace the bot token at runtime. */
  slack: () => SlackChannelTools;
  gmailAndCalendar: (userId: string) => Promise<ToolSet>;
  mySlackMessages: (userId: string) => Promise<ToolSet>;
  myKnowledge: (userId: string) => Promise<ToolSet>;
  workspaceKnowledge: () => Promise<ToolSet>;
  mcp: (userId: string) => Promise<ToolGroup[]>;
  logger: Logger;
}

/** Every group this user could have, before checking who reads the reply. */
export async function toolGroupsFor(
  userId: string,
  askedInChannelId: string | undefined,
  s: ToolSources,
): Promise<ToolGroup[]> {
  const groups: ToolGroup[] = [
    { name: "gmail-calendar", whoCanSeeResults: onlyUser(userId), build: () => s.gmailAndCalendar(userId) },
    { name: "my-slack-messages", whoCanSeeResults: onlyUser(userId), build: () => s.mySlackMessages(userId) },
    { name: "my-knowledge", whoCanSeeResults: onlyUser(userId), build: () => s.myKnowledge(userId) },
    { name: "workspace-knowledge", whoCanSeeResults: everyoneInWorkspace, build: () => s.workspaceKnowledge() },
    { name: "public-channels", whoCanSeeResults: everyoneInWorkspace, build: async () => s.slack().publicChannels() },
  ];
  if (askedInChannelId) {
    groups.push({
      name: "this-channel",
      whoCanSeeResults: membersOfChannel(askedInChannelId),
      build: async () => s.slack().thisChannel(askedInChannelId),
    });
  }
  return [...groups, ...(await s.mcp(userId))];
}

export function createToolProvider(sources: ToolSources): ToolProvider {
  return {
    async toolsFor(request: ToolRequest) {
      const groups = await toolGroupsFor(request.userId, request.askedInChannelId, sources);
      const allowed = groups.filter((g) => readersMaySee(request.readers, g.whoCanSeeResults));

      const built = await Promise.all(
        allowed.map(async (g) => {
          try {
            return { group: g, tools: await g.build() };
          } catch (err) {
            sources.logger.warn({ group: g.name, err: (err as Error).message }, "tool group failed to build");
            return { group: g, tools: {} as ToolSet };
          }
        }),
      );
      const used = built.filter((b) => Object.keys(b.tools).length > 0);

      // MCP tool names all start with mcp_, so no group can shadow another's tools.
      const tools: ToolSet = Object.assign({}, ...used.map((b) => b.tools));
      if (request.continueInDm) tools.continue_in_dm = continueInDmTool(request.continueInDm);

      return {
        tools,
        whoCanSeeResults: used.length ? used.map((b) => b.group.whoCanSeeResults).reduce(strictestOf) : null,
      };
    },
    names(tools: Tools): string[] {
      return Object.keys(tools as ToolSet);
    },
  };
}

/**
 * Takes no input on purpose: the model can't choose what is asked privately.
 * The asker's own message is re-asked in their DM after this reply is sent.
 */
function continueInDmTool(requestFollowUp: () => void) {
  return tool({
    description:
      "Send the part of the answer that needs the asker's private context (their email, calendar, DMs, private " +
      "channels, what tino knows about them) to their DM. Their original question is answered again there, privately. " +
      "Call at most once, and still answer what you can here.",
    inputSchema: z.object({}),
    execute: async () => {
      requestFollowUp();
      return { sentToDm: true, note: "tell them you've sent the rest to their DMs" };
    },
  });
}
