import { LinearClient } from '@linear/sdk';
import type { Env } from '../../env.js';

/**
 * Single shared LinearClient instance.
 *
 * Throws if LINEAR_DEVELOPER_TOKEN is unset. Caller (`linearCapability.registerTools`
 * in `capabilities/linear.ts`) catches and degrades gracefully — the bot
 * keeps running without the Linear tools.
 */
export function createLinearClient(env: Env): LinearClient {
  if (!env.LINEAR_DEVELOPER_TOKEN) {
    throw new Error('LINEAR_DEVELOPER_TOKEN is not set — Linear tools are disabled');
  }
  return new LinearClient({ apiKey: env.LINEAR_DEVELOPER_TOKEN });
}
