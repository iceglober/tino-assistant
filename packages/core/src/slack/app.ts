import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { HistoryStore } from "../agent/history.js";
import type { AuditLogger } from "../audit/logger.js";
import type { ConfigStore } from "../persistence/config.js";
import type { IdentityResolver } from "../identity/resolver.js";
import type { IdentityStore, UserStore } from "../identity/store.js";
import type { Env } from "../env.js";
import { toSlackMrkdwn } from "./mrkdwn.js";
import { handleResetCommand } from "./reset.js";
import { resolveDmSender } from "./resolve-dm-sender.js";
import type { DmMessageEvent } from "./types.js";

export type DmHandler = (userId: string, text: string) => Promise<string>;

/** Minimal logger interface — matches the pino subset we actually call. */
export interface AppLogger {
  debug: (msgOrObj: unknown, msg?: string) => void;
  info: (msgOrObj: unknown, msg?: string) => void;
  warn: (msgOrObj: unknown, msg?: string) => void;
  error: (msgOrObj: unknown, msg?: string) => void;
}

export async function handleDmMessage(params: {
  message: Partial<DmMessageEvent>;
  onDm: DmHandler;
  say: (args: { text: string }) => Promise<unknown>;
  client: WebClient;
  logger: AppLogger;
  identityResolver: IdentityResolver;
  users: UserStore;
  identities: IdentityStore;
  configStore: ConfigStore;
  auditLogger?: AuditLogger;
  seenUsers?: Set<string>;
}): Promise<void> {
  const { message: m, onDm, say, client, logger, identityResolver, users, identities, configStore, auditLogger, seenUsers } = params;

  if (m.subtype !== undefined) {
    logger.debug({ subtype: m.subtype }, "ignored message with subtype");
    return;
  }

  if (m.channel_type !== "im") {
    logger.debug({ channelType: m.channel_type, channel: m.channel }, "ignored non-DM");
    return;
  }

  if (!m.user) {
    logger.debug("ignored DM with no user");
    return;
  }

  if (typeof m.text !== "string" || m.text.length === 0) {
    logger.debug("ignored DM with no text");
    return;
  }

  const tinoUserId = await resolveDmSender(m.user, {
    identityResolver,
    users,
    identities,
    configStore,
    say,
    auditLogger,
    logger,
  });
  if (!tinoUserId) return;

  try {
    logger.info({ user: m.user, tinoUserId, channel: m.channel, textLen: m.text.length }, "DM received");

    if (auditLogger && seenUsers && !seenUsers.has(tinoUserId)) {
      seenUsers.add(tinoUserId);
      await auditLogger.log({
        userId: tinoUserId,
        action: "login",
        status: "success",
      });
    }

    const placeholder = await say({ text: "thinking..." });
    const placeholderTs = (placeholder as { ts?: string })?.ts;

    const start = Date.now();
    const reply = await onDm(tinoUserId, m.text);
    const formatted = toSlackMrkdwn(reply);

    if (placeholderTs && m.channel) {
      await client.chat.update({ channel: m.channel, ts: placeholderTs, text: formatted });
    } else {
      await say({ text: formatted });
    }
    logger.info(
      { user: m.user, tinoUserId, channel: m.channel, replyLen: formatted.length, durationMs: Date.now() - start },
      "DM handled",
    );
  } catch (err) {
    logger.error({ err }, "handler threw");
    await say({ text: "something went wrong — check the logs." });
  }
}

export interface CreateSlackAppOpts {
  env: Env;
  onDm: DmHandler;
  logger: AppLogger;
  history: HistoryStore;
  identityResolver: IdentityResolver;
  users: UserStore;
  identities: IdentityStore;
  configStore: ConfigStore;
  auditLogger?: AuditLogger;
}

export function createSlackApp(opts: CreateSlackAppOpts): App {
  const { env, onDm, logger, history, identityResolver, users, identities, configStore, auditLogger } = opts;

  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  const seen = new Set<string>();
  const SEEN_CAP = 1000;
  const seenUsers = new Set<string>();

  app.message(async ({ message, say }) => {
    const isReset = await handleResetCommand({
      message: message as Partial<DmMessageEvent>,
      identityResolver,
      users,
      history,
      say,
      logger,
    });
    if (isReset) return;

    const ts = (message as Partial<DmMessageEvent>).ts;
    if (ts) {
      if (seen.has(ts)) {
        logger.debug({ ts }, "duplicate event (already processing), skipped");
        return;
      }
      seen.add(ts);
      if (seen.size > SEEN_CAP) {
        const iter = seen.values();
        for (let i = 0; i < SEEN_CAP / 2; i++) iter.next();
        const keep = [...seen].slice(SEEN_CAP / 2);
        seen.clear();
        for (const k of keep) seen.add(k);
      }
    }

    await handleDmMessage({
      message: message as Partial<DmMessageEvent>,
      onDm,
      say,
      client: app.client,
      logger,
      identityResolver,
      users,
      identities,
      configStore,
      auditLogger,
      seenUsers,
    });
  });

  // Channel @mentions — reply in-thread
  app.event("app_mention", async ({ event, say }) => {
    const ts = event.ts;
    if (seen.has(ts)) return;
    seen.add(ts);

    if (!event.user || !event.text) return;

    // Strip the @tino mention from the text
    const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) {
      await say({ text: "hey — what can I help with?", thread_ts: event.ts });
      return;
    }

    const tinoUserId = await resolveDmSender(event.user, {
      identityResolver,
      users,
      identities,
      configStore,
      say: async (args) => { await say({ ...args, thread_ts: event.ts }); },
      auditLogger,
      logger,
    });
    if (!tinoUserId) return;

    try {
      logger.info({ user: event.user, tinoUserId, channel: event.channel, textLen: text.length }, "channel mention received");
      const placeholder = await say({ text: "thinking...", thread_ts: event.ts });
      const placeholderTs = (placeholder as { ts?: string })?.ts;

      // Fetch recent conversation context so tino understands what "this" refers to
      let contextPrefix = "";
      try {
        const threadTs = (event as { thread_ts?: string }).thread_ts;
        const historyResult = threadTs
          ? await app.client.conversations.replies({ channel: event.channel, ts: threadTs, limit: 30 })
          : await app.client.conversations.history({ channel: event.channel, latest: event.ts, limit: 20, inclusive: false });

        const msgs = (historyResult.messages ?? [])
          .filter((msg) => msg.ts !== event.ts && msg.text)
          .slice(-20);

        const privacyRule =
          "IMPORTANT: Your response will be visible to EVERYONE in this channel. " +
          "Do NOT include private information from the user's emails, DMs, calendar, or other personal tools in your response. " +
          "You may use private tools to inform your understanding (e.g., to look up context), but your reply must only contain information " +
          "that is appropriate for the audience in this channel. If fulfilling the request requires sharing private details, " +
          "tell the user to DM you instead.";

        if (msgs.length > 0) {
          const lines = msgs.map((msg) => {
            const who = msg.user ?? "unknown";
            return `<@${who}>: ${msg.text}`;
          });
          contextPrefix =
            "[You were @mentioned in a Slack channel. Below are the most recent messages from the conversation for context. " +
            "When the user says \"this\" or references something discussed, use this context to understand what they mean. " +
            "If you need more context than what's shown here, use your Slack tools (slack_search_messages, slack_read_channel, slack_read_channel_thread) " +
            "to find related messages, and any other tools (gmail, calendar, linear) that would help you fulfill the request. " +
            privacyRule + "\n\n" +
            lines.join("\n") +
            "\n]\n\n";
        } else {
          contextPrefix =
            "[You were @mentioned in a Slack channel but no prior messages were available. " +
            "If you need context, use your Slack and other tools to search for related information. " +
            privacyRule + "]\n\n";
        }
      } catch (histErr) {
        logger.warn({ err: histErr, channel: event.channel }, "failed to fetch channel context for mention");
        contextPrefix =
          "[You were @mentioned in a Slack channel but couldn't read the conversation history. " +
          "Use your Slack tools (slack_search_messages, slack_read_channel) and other tools to find context for what the user is referring to. " +
          "IMPORTANT: Your response will be visible to EVERYONE in this channel. " +
          "Do NOT include private information from emails, DMs, calendar, or other personal tools in your response. " +
          "If fulfilling the request requires sharing private details, tell the user to DM you instead.]\n\n";
      }

      const start = Date.now();
      const reply = await onDm(tinoUserId, contextPrefix + text);
      const formatted = toSlackMrkdwn(reply);

      if (placeholderTs) {
        await app.client.chat.update({ channel: event.channel, ts: placeholderTs, text: formatted });
      } else {
        await say({ text: formatted, thread_ts: event.ts });
      }
      logger.info(
        { user: event.user, tinoUserId, channel: event.channel, replyLen: formatted.length, durationMs: Date.now() - start },
        "channel mention handled",
      );
    } catch (err) {
      logger.error({ err }, "channel mention handler threw");
      await say({ text: "something went wrong — check the logs.", thread_ts: event.ts });
    }
  });

  return app;
}
