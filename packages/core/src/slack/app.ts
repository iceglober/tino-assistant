import { App, LogLevel } from '@slack/bolt';
import type { Env } from '../env.js';
import type { HistoryStore } from '../agent/history.js';
import { toSlackMrkdwn } from './mrkdwn.js';
import type { DmMessageEvent } from './types.js';
import { handleResetCommand } from './reset.js';
import type { AuditLogger } from '../audit/logger.js';

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
  env: Pick<Env, 'ALLOWED_SLACK_USER_ID'>;
  onDmFromOwner: DmHandler;
  say: (args: { text: string }) => Promise<unknown>;
  logger: AppLogger;
  auditLogger?: AuditLogger;
  /** Track first-message sessions to log a 'login' audit entry. */
  seenUsers?: Set<string>;
}): Promise<void> {
  const { message: m, env, onDmFromOwner, say, logger, auditLogger, seenUsers } = params;

  if (m.subtype !== undefined) {
    // bot_message, message_changed, message_deleted, thread_broadcast, etc.
    logger.debug({ subtype: m.subtype }, 'ignored message with subtype');
    return;
  }

  if (m.channel_type !== 'im') {
    logger.debug({ channelType: m.channel_type, channel: m.channel }, 'ignored non-DM');
    return;
  }

  if (!m.user) {
    logger.debug('ignored DM with no user');
    return;
  }

  if (m.user !== env.ALLOWED_SLACK_USER_ID) {
    logger.warn({ user: m.user, channel: m.channel }, 'rejected DM from non-allowlisted user');
    return;
  }

  if (typeof m.text !== 'string' || m.text.length === 0) {
    logger.debug('ignored DM with no text');
    return;
  }

  try {
    logger.info({ user: m.user, channel: m.channel, textLen: m.text.length }, 'owner DM received');

    // Log 'login' audit entry on first message from this user in this session
    if (auditLogger && seenUsers && !seenUsers.has(m.user)) {
      seenUsers.add(m.user);
      await auditLogger.log({
        userId: m.user,
        action: 'login',
        status: 'success',
      });
    }

    const start = Date.now();
    const reply = await onDmFromOwner(m.user, m.text);
    const formatted = toSlackMrkdwn(reply);
    await say({ text: formatted });
    logger.info(
      { user: m.user, channel: m.channel, replyLen: formatted.length, durationMs: Date.now() - start },
      'owner DM handled',
    );
  } catch (err) {
    logger.error({ err }, 'handler threw');
    await say({ text: 'Something went wrong. Check the logs.' });
  }
}

export function createSlackApp(env: Env, onDmFromOwner: DmHandler, logger: AppLogger, history: HistoryStore, auditLogger?: AuditLogger): App {
  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.WARN, // bolt is chatty on INFO
  });

  // Dedup: Socket Mode can re-deliver events if the handler takes >3s.
  // Track seen message timestamps to avoid double-processing.
  const seen = new Set<string>();
  const SEEN_CAP = 1000; // prevent unbounded growth; old entries don't matter

  // Track users who have sent at least one message this session (for login audit)
  const seenUsers = new Set<string>();

  app.message(async ({ message, say }) => {
    // Check for /reset command first (before dedup — /reset should always work)
    const isReset = await handleResetCommand({
      message: message as Partial<DmMessageEvent>,
      env,
      history,
      say,
      logger,
    });
    if (isReset) return;

    const ts = (message as Partial<DmMessageEvent>).ts;
    if (ts) {
      if (seen.has(ts)) {
        logger.debug({ ts }, 'duplicate event (already processing), skipped');
        return;
      }
      seen.add(ts);
      if (seen.size > SEEN_CAP) {
        // Evict oldest entries. Set iteration order is insertion order.
        const iter = seen.values();
        for (let i = 0; i < SEEN_CAP / 2; i++) iter.next();
        // Rebuild with the newer half
        const keep = [...seen].slice(SEEN_CAP / 2);
        seen.clear();
        for (const k of keep) seen.add(k);
      }
    }

    await handleDmMessage({
      message: message as Partial<DmMessageEvent>,
      env,
      onDmFromOwner,
      say,
      logger,
      auditLogger,
      seenUsers,
    });
  });

  return app;
}
