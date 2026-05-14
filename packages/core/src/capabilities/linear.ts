/**
 * Linear capability module.
 *
 * Registers linear_search_issues, linear_get_issue, linear_create_issue,
 * linear_update_issue, linear_add_comment, linear_list_my_issues tools.
 *
 * findWork: polls for issues assigned to tino in autoPickupStates.
 * Migrated from src/scheduler/linear-poller.ts.
 */
import type { ToolSet } from 'ai';
import type { ConfigStore } from '../persistence/config.js';
import type { AppLogger } from '../slack/app.js';
import type { CapabilityConfig, CapabilityModule } from './types.js';
import { LinearClient } from '@linear/sdk';
import {
  linearSearchIssuesTool,
  linearGetIssueTool,
  linearCreateIssueTool,
  linearUpdateIssueTool,
  linearAddCommentTool,
  linearListMyIssuesTool,
} from '../tools/linear/issues.js';

export const linearCapability: CapabilityModule = {
  id: 'linear',
  displayName: 'Linear',

  async registerTools(
    config: CapabilityConfig,
    _configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void> {
    const token = config.credentials['token'];
    if (!token) {
      throw new Error('Linear capability: credentials.token is not set');
    }

    const linearClient = new LinearClient({ apiKey: token });

    tools['linear_search_issues'] = linearSearchIssuesTool(linearClient);
    tools['linear_get_issue'] = linearGetIssueTool(linearClient);
    tools['linear_create_issue'] = linearCreateIssueTool(linearClient);
    tools['linear_update_issue'] = linearUpdateIssueTool(linearClient);
    tools['linear_add_comment'] = linearAddCommentTool(linearClient);
    tools['linear_list_my_issues'] = linearListMyIssuesTool(linearClient);

    logger.info('linear tools enabled');
  },

  startFindWork(
    config: CapabilityConfig,
    logger: AppLogger,
    onNewWork: (summary: string) => Promise<void>,
  ): () => void {
    const token = config.credentials['token'];
    if (!token) {
      logger.warn('linear findWork: credentials.token not set, skipping');
      return () => {};
    }

    const intervalMinutes = config.findWork?.intervalMinutes ?? 15;
    const intervalMs = intervalMinutes * 60 * 1000;
    const linearClient = new LinearClient({ apiKey: token });
    const seenIssueIds = new Set<string>();

    const poll = async () => {
      try {
        const me = await linearClient.viewer;
        const assignedIssues = await linearClient.issues({
          filter: {
            assignee: { id: { eq: me.id } },
            state: { type: { in: ['backlog', 'unstarted'] } },
          },
          first: 20,
        });

        const issues = assignedIssues.nodes;
        const newIssues = issues.filter(i => !seenIssueIds.has(i.id));

        if (newIssues.length === 0) {
          logger.debug('linear findWork: no new assigned issues');
          return;
        }

        logger.info({ count: newIssues.length }, 'linear findWork: found new assigned issues');

        for (const issue of newIssues) {
          seenIssueIds.add(issue.id);
          try {
            const summary = [
              `A Linear issue has been assigned to you:`,
              `- Identifier: ${issue.identifier}`,
              `- Title: ${issue.title}`,
              `- URL: ${issue.url}`,
              issue.description ? `- Description: ${issue.description}` : '',
            ].filter(Boolean).join('\n');
            await onNewWork(summary);
          } catch (err) {
            logger.error(
              { issueId: issue.id, identifier: issue.identifier, err: (err as Error).message },
              'linear findWork: failed to process issue',
            );
          }
        }
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'linear findWork: poll failed');
      }
    };

    // Run immediately on start, then on interval
    void poll();
    const handle = setInterval(() => void poll(), intervalMs);

    logger.info({ intervalMinutes }, 'linear findWork poller started');
    return () => clearInterval(handle);
  },
};
