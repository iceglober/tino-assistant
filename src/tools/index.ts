import type { ToolSet } from 'ai';
import type { Env } from '../env.js';
import type { AppLogger } from '../slack/app.js';
import { createOctokit } from './github/client.js';
import { githubSearchCodeTool } from './github/search.js';
import { githubGetFileTool } from './github/getFile.js';

/**
 * Build the toolset for `runAgent`.
 *
 * Each tool category is constructed in a try/catch so that a missing
 * credential disables only that category — the bot keeps running.
 *
 * Phase 4: github_search_code, github_get_file.
 * Phase 5+: cloudwatch_logs_query, calendar_list_events, gmail_search.
 */
export function buildTools(env: Env, logger: AppLogger): ToolSet {
  const tools: ToolSet = {};

  try {
    const octokit = createOctokit(env);
    tools['github_search_code'] = githubSearchCodeTool(octokit);
    tools['github_get_file'] = githubGetFileTool(octokit);
    logger.info('github tools enabled');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'github tools disabled');
  }

  return tools;
}
