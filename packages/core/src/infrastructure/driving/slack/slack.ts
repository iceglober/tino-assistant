/**
 * Slack driving adapter. Turns Slack DMs and channel @mentions into calls on the
 * inbound ports (SenderResolver + Assistant) and presents the results. It knows
 * nothing about the model, tools, or persistence — only Slack and the ports.
 */
import { App, LogLevel } from "@slack/bolt";
import type { Env } from "../../../env.js";
import type { Assistant, SenderResolver } from "../../../ports/inbound.js";
import type { Logger } from "../../../ports/outbound.js";
import { toSlackMrkdwn } from "./mrkdwn.js";
import type { DmMessageEvent } from "./types.js";

export interface CreateSlackAppOpts {
  env: Env;
  assistant: Assistant;
  senderResolver: SenderResolver;
  logger: Logger;
  /** Build the personal Slack OAuth connect link for a user (enables the `connect` command). */
  connectLink?: (userId: string) => string;
}

export function createSlackApp(opts: CreateSlackAppOpts): App {
  const { env, assistant, senderResolver, logger, connectLink } = opts;

  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  const seen = new Set<string>();
  const SEEN_CAP = 1000;
  const remember = (ts: string): boolean => {
    if (seen.has(ts)) return false;
    seen.add(ts);
    if (seen.size > SEEN_CAP) {
      const keep = [...seen].slice(SEEN_CAP / 2);
      seen.clear();
      for (const k of keep) seen.add(k);
    }
    return true;
  };

  // ── Direct messages ────────────────────────────────────────────────────────
  app.message(async ({ message, say }) => {
    const m = message as Partial<DmMessageEvent>;
    if (m.subtype !== undefined || m.channel_type !== "im" || !m.user) return;
    if (typeof m.text !== "string" || m.text.length === 0) return;
    if (m.ts && !remember(m.ts)) return;

    const res = await senderResolver.resolveSlack(m.user);
    if (!res.ok) {
      await say({ text: res.message });
      return;
    }
    const userId = res.userId;

    try {
      const cmd = m.text.trim().toLowerCase();
      // Bare "reset" (not "/reset" — Slack intercepts slash commands client-side).
      if (cmd === "reset" && (await assistant.reset(userId))) {
        await say({ text: "History cleared." });
        return;
      }
      // "connect" — grant tino a personal Slack token to read your own messages.
      if ((cmd === "connect" || cmd === "connect slack") && connectLink) {
        await say({
          text: `connect your Slack so I can read your own messages (DMs, private channels, search) on your behalf:\n${connectLink(userId)}\n\nthe link is personal and expires in 15 minutes.`,
        });
        return;
      }

      logger.info({ user: m.user, tinoUserId: userId, channel: m.channel, textLen: m.text.length }, "DM received");
      const placeholder = await say({ text: "thinking..." });
      const placeholderTs = (placeholder as { ts?: string })?.ts;

      const start = Date.now();
      const formatted = toSlackMrkdwn(await assistant.handleMessage(userId, m.text));

      if (placeholderTs && m.channel) {
        await app.client.chat.update({ channel: m.channel, ts: placeholderTs, text: formatted });
      } else {
        await say({ text: formatted });
      }
      logger.info(
        { user: m.user, tinoUserId: userId, channel: m.channel, replyLen: formatted.length, durationMs: Date.now() - start },
        "DM handled",
      );
    } catch (err) {
      logger.error({ err }, "handler threw");
      await say({ text: "something went wrong — check the logs." });
    }
  });

  // ── Channel @mentions — reply in-thread ──────────────────────────────────────
  app.event("app_mention", async ({ event, say }) => {
    if (!remember(event.ts)) return;
    if (!event.user || !event.text) return;

    const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) {
      await say({ text: "hey — what can I help with?", thread_ts: event.ts });
      return;
    }

    const res = await senderResolver.resolveSlack(event.user);
    if (!res.ok) {
      await say({ text: res.message, thread_ts: event.ts });
      return;
    }
    const userId = res.userId;

    try {
      logger.info({ user: event.user, tinoUserId: userId, channel: event.channel, textLen: text.length }, "channel mention received");
      const placeholder = await say({ text: "thinking...", thread_ts: event.ts });
      const placeholderTs = (placeholder as { ts?: string })?.ts;

      const contextPrefix = await buildMentionContext(app, event, logger);

      const start = Date.now();
      const formatted = toSlackMrkdwn(await assistant.handleMessage(userId, contextPrefix + text));

      if (placeholderTs) {
        await app.client.chat.update({ channel: event.channel, ts: placeholderTs, text: formatted });
      } else {
        await say({ text: formatted, thread_ts: event.ts });
      }
      logger.info(
        { user: event.user, tinoUserId: userId, channel: event.channel, replyLen: formatted.length, durationMs: Date.now() - start },
        "channel mention handled",
      );
    } catch (err) {
      logger.error({ err }, "channel mention handler threw");
      await say({ text: "something went wrong — check the logs.", thread_ts: event.ts });
    }
  });

  return app;
}

const PRIVACY_RULE =
  "IMPORTANT: Your response will be visible to EVERYONE in this channel. " +
  "Do NOT include private information from the user's emails, DMs, calendar, or other personal tools in your response. " +
  "You may use private tools to inform your understanding, but your reply must only contain information " +
  "that is appropriate for the audience in this channel. If fulfilling the request requires sharing private details, " +
  "tell the user to DM you instead.";

/** Fetch recent channel/thread messages so tino understands what "this" refers to. */
async function buildMentionContext(
  app: App,
  event: { channel: string; ts: string; thread_ts?: string },
  logger: Logger,
): Promise<string> {
  try {
    const threadTs = event.thread_ts;
    const historyResult = threadTs
      ? await app.client.conversations.replies({ channel: event.channel, ts: threadTs, limit: 30 })
      : await app.client.conversations.history({ channel: event.channel, latest: event.ts, limit: 20, inclusive: false });

    const msgs = (historyResult.messages ?? []).filter((msg) => msg.ts !== event.ts && msg.text).slice(-20);

    if (msgs.length > 0) {
      const lines = msgs.map((msg) => `<@${msg.user ?? "unknown"}>: ${msg.text}`);
      return (
        "[You were @mentioned in a Slack channel. Below are the most recent messages from the conversation for context. " +
        'When the user says "this" or references something discussed, use this context to understand what they mean. ' +
        "If you need more context, use your Slack tools (slack_read_channel, slack_read_channel_thread) and any other tools (gmail, calendar) that would help. " +
        PRIVACY_RULE +
        "\n\n" +
        lines.join("\n") +
        "\n]\n\n"
      );
    }
    return (
      "[You were @mentioned in a Slack channel but no prior messages were available. " +
      "If you need context, use your Slack and other tools to search for related information. " +
      PRIVACY_RULE +
      "]\n\n"
    );
  } catch (histErr) {
    logger.warn({ err: histErr, channel: event.channel }, "failed to fetch channel context for mention");
    return (
      "[You were @mentioned in a Slack channel but couldn't read the conversation history. " +
      "Use your Slack tools and other tools to find context for what the user is referring to. " +
      PRIVACY_RULE +
      "]\n\n"
    );
  }
}
