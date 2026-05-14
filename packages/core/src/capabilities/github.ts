/**
 * GitHub capability module.
 *
 * Registers github_search_code, github_get_file, github_list_workflow_runs,
 * github_get_workflow_run_logs tools. Reads credentials and settings from
 * the capability config stored in the config table.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */
import type { ToolSet } from 'ai';
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';
import type { CapabilityConfig, CapabilityModule } from './types.js';
import { Octokit } from '@octokit/rest';
import { githubSearchCodeTool } from '../tools/github/search.js';
import { githubGetFileTool } from '../tools/github/getFile.js';
import { githubListWorkflowRunsTool, githubGetWorkflowRunLogsTool } from '../tools/github/workflows.js';
import { parseRepoSpec, type RepoSpec } from '../tools/github/allowlist.js';

export const githubCapability: CapabilityModule = {
  id: 'github',
  displayName: 'GitHub',

  async registerTools(
    config: CapabilityConfig,
    _configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void> {
    const token = config.credentials['token'];
    if (!token) {
      throw new Error('GitHub capability: credentials.token is not set');
    }

    const octokit = new Octokit({ auth: token, userAgent: 'tino/0.1' });

    // Resolve allowlist from capability settings
    const reposRaw = (config.settings['repos'] as string[] | undefined) ?? [];
    const allowedRepos: RepoSpec[] = reposRaw.flatMap(s => {
      const parsed = parseRepoSpec(s);
      return parsed ? [parsed] : [];
    });

    // Resolve default repo from capability settings
    let defaultRepo: RepoSpec | undefined;
    const defaultRepoRaw = config.settings['defaultRepo'] as string | undefined;
    if (defaultRepoRaw) {
      defaultRepo = parseRepoSpec(defaultRepoRaw) ?? undefined;
    }

    tools['github_search_code'] = githubSearchCodeTool({ octokit, defaultRepo, allowedRepos });
    tools['github_get_file'] = githubGetFileTool({ octokit, defaultRepo, allowedRepos });
    tools['github_list_workflow_runs'] = githubListWorkflowRunsTool({ octokit, defaultRepo, allowedRepos });
    tools['github_get_workflow_run_logs'] = githubGetWorkflowRunLogsTool({ octokit, defaultRepo, allowedRepos });

    logger.info(
      {
        defaultRepo: defaultRepo ? `${defaultRepo.owner}/${defaultRepo.repo}` : null,
        allowedReposCount: allowedRepos.length,
      },
      'github tools enabled',
    );
  },
};
