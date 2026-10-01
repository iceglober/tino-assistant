/**
 * The assistant use-case. Pure orchestration over ports — no SDK, framework, or
 * infrastructure imports.
 *
 * Each reply:
 *   1. works out who will read it (application/readers.ts),
 *   2. loads only what those readers may see: tools, this thread's history, and
 *      a few messages recalled from this person's other conversations,
 *   3. saves the new messages labelled with who may see them.
 *
 * A channel reply that needs the asker's private context can hand that part to
 * their DM. The private answer is produced by a separate DM reply after the
 * channel reply is saved; nothing private ever flows back into the channel.
 */
import { buildSystemPrompt, type RecalledMessage } from "../domain/prompt.js";
import { channelOfThreadKey, channelThreadKey, directThreadKey } from "../domain/types.js";
import { membersOfChannel, onlyUser, type Readers, readersMaySee, strictestOf } from "../domain/who-can-see.js";
import type { Assistant, Surface } from "../ports/inbound.js";
import type {
  AskedWhere,
  ChannelDirectory,
  ChatModel,
  ConfigStore,
  ConversationLog,
  DirectMessenger,
  LoggedMessage,
  Logger,
  ToolProvider,
  UserStore,
} from "../ports/outbound.js";
import { readersFor } from "./readers.js";

export interface AssistantDeps {
  model: ChatModel;
  tools: ToolProvider;
  conversations: ConversationLog;
  users: UserStore;
  config: ConfigStore;
  /** Slack channel lookups. Null before Slack is connected (web chat still works). */
  directory: () => ChannelDirectory | null;
  /** Sends the DM follow-up. Null before Slack is connected. */
  messenger: () => DirectMessenger | null;
  logger: Logger;
}

/** How many messages of the current thread the model sees. */
const THREAD_MESSAGES = 40;
/** How many of the asker's recent messages are considered for recall. */
const RECALL_CANDIDATES = 60;
/** How many recalled messages from other conversations the model sees. */
const RECALLED_MESSAGES = 10;

export function createAssistant(deps: AssistantDeps): Assistant {
  const { model, tools, conversations, users, config, logger } = deps;

  const threadKeyOf = (userId: string, surface: Surface): string =>
    surface.kind === "channel" ? channelThreadKey(surface.channelId, surface.threadTs) : directThreadKey(userId);

  /** This thread's messages the readers may see, whole turns only, ready for the model. */
  function visibleHistory(rows: LoggedMessage[], readers: Readers): LoggedMessage[] {
    const visible = rows.filter((m) => readersMaySee(readers, m.whoCanSee)).slice(-THREAD_MESSAGES);
    // Never start on a tool result whose call was cut off — providers reject that.
    let start = 0;
    while (start < visible.length && visible[start]?.role === "tool") start += 1;
    return visible.slice(start);
  }

  /** Messages from this person's other conversations the readers may see. */
  function recall(rows: LoggedMessage[], threadKey: string, readers: Readers): RecalledMessage[] {
    return rows
      .filter((m) => m.threadKey !== threadKey && m.text && readersMaySee(readers, m.whoCanSee))
      .slice(-RECALLED_MESSAGES)
      .map((m) => ({
        role: m.role === "user" ? "user" : "tino",
        text: m.text as string,
        where: m.askedWhere,
        channelId: channelOfThreadKey(m.threadKey),
        at: m.createdAt,
      }));
  }

  async function reply(userId: string, text: string, surface: Surface): Promise<string> {
    const start = Date.now();
    const asker = (await users.get(userId)) ?? { id: userId, slackUserId: null };
    const readers = await readersFor(surface, asker, {
      directory: deps.directory(),
      config,
      logger,
    });
    const threadKey = threadKeyOf(userId, surface);
    const askedWhere: AskedWhere = surface.kind;

    let dmFollowUpRequested = false;
    const othersWillRead = readers.soleReaderId === null;

    const [thread, askedBefore, toolset] = await Promise.all([
      conversations.recentInThread(threadKey, THREAD_MESSAGES * 3),
      conversations.recentAskedBy(userId, RECALL_CANDIDATES),
      tools.toolsFor({
        userId,
        readers,
        askedInChannelId: surface.kind === "channel" ? surface.channelId : undefined,
        continueInDm:
          othersWillRead && surface.kind === "channel" && deps.messenger()
            ? () => {
                dmFollowUpRequested = true;
              }
            : undefined,
      }),
    ]);

    const system = buildSystemPrompt({
      toolNames: tools.names(toolset.tools),
      readers: { onlyTheAsker: !othersWillRead, includesOutsiders: readers.includesOutsiders },
      recalled: recall(askedBefore, threadKey, readers),
    });

    const userText =
      surface.kind === "channel" && surface.recentChannelMessages
        ? `${surface.recentChannelMessages.trimEnd()}\n\n${text}`
        : text;

    const { text: replyText, newMessages } = await model.reply({
      system,
      history: visibleHistory(thread, readers).map((m) => m.message),
      userText,
      tools: toolset.tools,
    });

    // The question itself is only as visible as the place it was asked.
    const askedWhereCanSee = surface.kind === "channel" ? membersOfChannel(surface.channelId) : onlyUser(userId);
    const whoCanSee = toolset.whoCanSeeResults
      ? strictestOf(askedWhereCanSee, toolset.whoCanSeeResults)
      : askedWhereCanSee;
    const turnId = crypto.randomUUID();
    const now = Date.now();
    await conversations.append(
      newMessages.map((message, i) => {
        const { role, text: plain } = model.describe(message);
        return {
          threadKey,
          turnId,
          askedBy: userId,
          askedWhere,
          whoCanSee,
          role,
          text: plain,
          message,
          createdAt: now + i, // keeps order stable within a turn
        };
      }),
    );

    logger.info(
      {
        user: userId,
        askedWhere,
        onlyTheAsker: !othersWillRead,
        includesOutsiders: readers.includesOutsiders,
        tools: tools.names(toolset.tools).length,
        dmFollowUp: dmFollowUpRequested,
        durationMs: Date.now() - start,
      },
      "assistant reply",
    );

    if (dmFollowUpRequested && surface.kind === "channel") void followUpInDm(userId, text, surface);

    // A run can end on a tool call with no follow-up text; the placeholder
    // avoids posting an empty message (which Slack rejects).
    return replyText || "(no response)";
  }

  /**
   * Answer the asker's own question again, privately. The question is passed
   * word for word — never text the model wrote — so a message planted in the
   * channel can't choose what gets asked with the asker's private tools.
   */
  async function followUpInDm(userId: string, question: string, surface: Surface & { kind: "channel" }): Promise<void> {
    const messenger = deps.messenger();
    if (!messenger) return;
    const origin = surface.permalink ? `<#${surface.channelId}> (${surface.permalink})` : `<#${surface.channelId}>`;
    try {
      const answer = await reply(
        userId,
        `${question}\n\n(I asked this in ${origin}. Answer it here using my private context too.)`,
        { kind: "slack_dm" },
      );
      await messenger.sendToUser(userId, `about your question in <#${surface.channelId}>:\n\n${answer}`);
    } catch (err) {
      logger.error({ user: userId, err: (err as Error).message }, "DM follow-up failed");
    }
  }

  return {
    handleMessage: reply,

    async reset(userId: string): Promise<boolean> {
      if (!(await users.get(userId))) return false;
      await conversations.clearThread(directThreadKey(userId));
      logger.info({ user: userId }, "direct conversation cleared");
      return true;
    },
  };
}
