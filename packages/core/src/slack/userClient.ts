import { webApi } from '@slack/bolt';
import type { Env } from '../env.js';

/**
 * Create a Slack WebClient using the owner's user token (xoxp-).
 *
 * This client acts AS the owner — it sees exactly what the owner sees
 * in Slack (channels they're a member of, search results they'd get).
 * It is NOT the bot client (which uses xoxb-).
 *
 * Throws if SLACK_USER_TOKEN is not set. Caller (`slackCapability.registerTools`
 * in `capabilities/slack.ts`) catches and degrades gracefully.
 */
export function createSlackUserClient(env: Env): webApi.WebClient {
  if (!env.SLACK_USER_TOKEN) {
    throw new Error('SLACK_USER_TOKEN is not set — Slack reading tools are disabled');
  }
  return new webApi.WebClient(env.SLACK_USER_TOKEN);
}
