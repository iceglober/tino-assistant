import type { Env } from '../env.js';
import type { AppLogger } from './app.js';
import type { HistoryStore } from '../agent/history.js';
import type { DmMessageEvent } from './types.js';

export interface ResetHandlerParams {
  message: Partial<DmMessageEvent>;
  env: Pick<Env, 'ALLOWED_SLACK_USER_ID'>;
  history: HistoryStore;
  say: (args: { text: string }) => Promise<unknown>;
  logger: AppLogger;
}

/**
 * Handle the /reset command. Returns true if the message was a /reset command
 * (and was handled), false otherwise (caller should continue to the normal
 * agent handler).
 *
 * Guards: same DM + allowlist filter as handleDmMessage. Only matches
 * messages whose trimmed text is exactly "/reset" (case-insensitive).
 */
export async function handleResetCommand(params: ResetHandlerParams): Promise<boolean> {
  const { message: m, env, history, say, logger } = params;

  // Same guards as handleDmMessage — subtype, channel_type, user
  if (m.subtype !== undefined) return false;
  if (m.channel_type !== 'im') return false;
  if (m.user !== env.ALLOWED_SLACK_USER_ID) return false;

  const text = (m.text ?? '').trim().toLowerCase();
  if (text !== '/reset') return false;

  // It's a /reset command from the owner in a DM.
  history.reset(m.user);
  logger.info({ user: m.user }, 'conversation history reset');
  await say({ text: 'History cleared.' });
  return true;
}
