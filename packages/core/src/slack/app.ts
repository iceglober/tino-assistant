import { App, LogLevel } from "@slack/bolt";
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
  logger: AppLogger;
  identityResolver: IdentityResolver;
  users: UserStore;
  identities: IdentityStore;
  configStore: ConfigStore;
  auditLogger?: AuditLogger;
  seenUsers?: Set<string>;
}): Promise<void> {
  const { message: m, onDm, say, logger, identityResolver, users, identities, configStore, auditLogger, seenUsers } = params;

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

    const start = Date.now();
    const reply = await onDm(tinoUserId, m.text);
    const formatted = toSlackMrkdwn(reply);
    await say({ text: formatted });
    logger.info(
      { user: m.user, tinoUserId, channel: m.channel, replyLen: formatted.length, durationMs: Date.now() - start },
      "DM handled",
    );
  } catch (err) {
    logger.error({ err }, "handler threw");
    await say({ text: "Something went wrong. Check the logs." });
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
      logger,
      identityResolver,
      users,
      identities,
      configStore,
      auditLogger,
      seenUsers,
    });
  });

  return app;
}
