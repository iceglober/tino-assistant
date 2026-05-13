import type { ToolSet } from 'ai';
import type { Env } from '../env.js';
import type { AppLogger } from '../slack/app.js';
import { createOctokit } from './github/client.js';
import { githubSearchCodeTool } from './github/search.js';
import { githubGetFileTool } from './github/getFile.js';
import { githubListWorkflowRunsTool, githubGetWorkflowRunLogsTool } from './github/workflows.js';
import { isAllowedRepo, parseRepoSpec, type RepoSpec } from './github/allowlist.js';
import { createCloudWatchLogsClient } from './cloudwatch/client.js';
import { cloudwatchLogsQueryTool } from './cloudwatch/query.js';
import { ALLOWED_LOG_GROUPS } from './cloudwatch/allowlist.js';
import { createGoogleAuth } from './google/oauth.js';
import { calendarListEventsTool } from './google/calendar.js';
import { gmailSearchTool, gmailGetMessageTool } from './google/gmail.js';
import { createPreferencesStore } from '../persistence/preferences.js';
import { setPreferenceTool, getPreferencesTool } from './preferences.js';

/**
 * Build the toolset for `runAgent`.
 *
 * Each tool category is constructed in a try/catch so that a missing
 * credential disables only that category — the bot keeps running.
 *
 * Phase 4: github_search_code, github_get_file.
 * Phase 5+: cloudwatch_logs_query, calendar_list_events, gmail_search.
 * Quick-wins: gmail_get_message, github_list_workflow_runs, github_get_workflow_run_logs, set_preference, get_preferences.
 */
export function buildTools(env: Env, logger: AppLogger): ToolSet {
  const tools: ToolSet = {};

  try {
    const octokit = createOctokit(env);
    const defaultRepo = resolveDefaultRepo(env, logger);
    tools['github_search_code'] = githubSearchCodeTool({ octokit, defaultRepo });
    tools['github_get_file'] = githubGetFileTool({ octokit, defaultRepo });
    tools['github_list_workflow_runs'] = githubListWorkflowRunsTool({ octokit, defaultRepo });
    tools['github_get_workflow_run_logs'] = githubGetWorkflowRunLogsTool({ octokit, defaultRepo });
    logger.info(
      { defaultRepo: defaultRepo ? `${defaultRepo.owner}/${defaultRepo.repo}` : null },
      'github tools enabled',
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'github tools disabled');
  }

  try {
    const client = createCloudWatchLogsClient(env);
    tools['cloudwatch_logs_query'] = cloudwatchLogsQueryTool({ client, logger });
    logger.info({ allowlistSize: ALLOWED_LOG_GROUPS.length }, 'cloudwatch tools enabled');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'cloudwatch tools disabled');
  }

  try {
    const auth = createGoogleAuth(env);
    tools['calendar_list_events'] = calendarListEventsTool(auth);
    tools['gmail_search'] = gmailSearchTool(auth);
    tools['gmail_get_message'] = gmailGetMessageTool(auth);
    logger.info('google tools enabled (calendar + gmail)');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'google tools disabled');
  }

  try {
    const dbPath = env.DB_PATH ?? './tino.db';
    const userId = env.ALLOWED_SLACK_USER_ID;
    const prefStore = createPreferencesStore({ dbPath });
    tools['set_preference'] = setPreferenceTool(prefStore, userId);
    tools['get_preferences'] = getPreferencesTool(prefStore, userId);
    logger.info('preferences tools enabled');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'preferences tools disabled');
  }

  return tools;
}

/**
 * Resolve GITHUB_DEFAULT_REPO into a typed RepoSpec, or undefined if unset.
 *
 * Fail-fast contract: if the env var is set but doesn't reference an
 * allowlisted repo, throw — this is almost certainly a typo (e.g.
 * GITHUB_DEFAULT_REPO=kn-eng/wrong-name) and silently falling back to
 * "no default" would mask the bug. The exception bubbles to buildTools'
 * try/catch, which disables the entire github toolset and logs the error
 * — visible at startup, not at the first tool call.
 */
function resolveDefaultRepo(env: Env, logger: AppLogger): RepoSpec | undefined {
  if (!env.GITHUB_DEFAULT_REPO) return undefined;

  const parsed = parseRepoSpec(env.GITHUB_DEFAULT_REPO);
  if (!parsed) {
    // The env schema's regex should catch this, but defense-in-depth.
    throw new Error(
      `GITHUB_DEFAULT_REPO=${env.GITHUB_DEFAULT_REPO} is not in "owner/repo" format`,
    );
  }

  if (!isAllowedRepo(parsed.owner, parsed.repo)) {
    throw new Error(
      `GITHUB_DEFAULT_REPO=${env.GITHUB_DEFAULT_REPO} is not in the allowlist. ` +
        `Add it to src/tools/github/allowlist.ts first.`,
    );
  }

  logger.debug({ defaultRepo: `${parsed.owner}/${parsed.repo}` }, 'github default repo resolved');
  return parsed;
}
