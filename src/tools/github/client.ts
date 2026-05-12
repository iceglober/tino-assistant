import { Octokit } from '@octokit/rest';
import type { Env } from '../../env.js';

/**
 * Single shared Octokit instance.
 *
 * Throws if GITHUB_TOKEN is unset. Caller (`buildTools`) catches and
 * degrades gracefully — the bot keeps running without the GitHub tools.
 */
export function createOctokit(env: Env): Octokit {
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set — GitHub tools are disabled');
  }

  return new Octokit({
    auth: env.GITHUB_TOKEN,
    userAgent: 'ausistant/0.1',
  });
}
