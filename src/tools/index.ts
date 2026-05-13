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
import type { TaskStore } from '../persistence/tasks.js';
import { scheduleTaskTool, listTasksTool, cancelTaskTool } from './tasks.js';
import { createSlackUserClient } from '../slack/userClient.js';
import { createUserCache } from '../slack/userCache.js';
import { slackSearchMessagesTool } from './slack/search.js';
import { slackReadThreadTool } from './slack/thread.js';
import { slackListDmsTool, slackReadDmTool } from './slack/dms.js';
import { slackListUsersTool } from './slack/users.js';

/**
 * Build the toolset for `runAgent`.
 *
 * Each tool category is constructed in a try/catch so that a missing
 * credential disables only that category — the bot keeps running.
 */
export async function buildTools(env: Env, logger: AppLogger, taskStore?: TaskStore): Promise<ToolSet> {
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

  if (taskStore) {
    try {
      const userId = env.ALLOWED_SLACK_USER_ID;
      tools['schedule_task'] = scheduleTaskTool(taskStore, userId);
      tools['list_tasks'] = listTasksTool(taskStore, userId);
      tools['cancel_task'] = cancelTaskTool(taskStore);
      logger.info('task tools enabled');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'task tools disabled');
    }
  }

  try {
    const userClient = createSlackUserClient(env);
    const userCache = await createUserCache(userClient, logger);
    tools['slack_search_messages'] = slackSearchMessagesTool(userClient, userCache);
    tools['slack_read_thread'] = slackReadThreadTool(userClient, userCache);
    tools['slack_list_dms'] = slackListDmsTool(userClient, userCache);
    tools['slack_read_dm'] = slackReadDmTool(userClient, userCache);
    tools['slack_list_users'] = slackListUsersTool(userCache);
    logger.info('slack reading tools enabled');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'slack reading tools disabled');
  }

  return tools;
}

export function resolveDefaultRepo(env: Env, logger: AppLogger): RepoSpec | undefined {
  if (!env.GITHUB_DEFAULT_REPO) return undefined;
  const parsed = parseRepoSpec(env.GITHUB_DEFAULT_REPO);
  if (!parsed) {
    logger.warn({ value: env.GITHUB_DEFAULT_REPO }, 'GITHUB_DEFAULT_REPO is not in owner/repo format — ignored');
    return undefined;
  }
  if (!isAllowedRepo(parsed.owner, parsed.repo)) {
    logger.warn({ repo: env.GITHUB_DEFAULT_REPO }, 'GITHUB_DEFAULT_REPO is not in the allowlist — ignored');
    return undefined;
  }
  return parsed;
}
