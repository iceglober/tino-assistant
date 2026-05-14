import type { LinearClient } from '@linear/sdk';
import type { AppLogger } from '../slack/app.js';

export interface LinearPollerDeps {
  linearClient: LinearClient;
  logger: AppLogger;
  onNewIssue: (issue: { id: string; identifier: string; title: string; description?: string; url: string }) => Promise<void>;
  intervalMs?: number; // default 15 minutes
}

/**
 * Polls Linear every 15 minutes for issues assigned to tino (the viewer)
 * that are in a "Todo" or "Backlog" state. When a new issue is found,
 * calls onNewIssue — which typically runs it through the agent loop,
 * posts findings as a comment, and DMs the owner.
 *
 * Tracks seen issue IDs in memory to avoid re-processing. The set resets
 * on process restart, but that's fine — the agent loop is idempotent
 * (posting a second comment is harmless, and the status check prevents
 * re-processing issues already moved to "In Progress").
 */
export function startLinearPoller(deps: LinearPollerDeps): () => void {
  const { linearClient, logger, onNewIssue, intervalMs = 15 * 60 * 1000 } = deps;
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
        logger.debug('linear poller: no new assigned issues');
        return;
      }

      logger.info({ count: newIssues.length }, 'linear poller: found new assigned issues');

      for (const issue of newIssues) {
        seenIssueIds.add(issue.id);
        try {
          await onNewIssue({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? undefined,
            url: issue.url,
          });
        } catch (err) {
          logger.error(
            { issueId: issue.id, identifier: issue.identifier, err: (err as Error).message },
            'linear poller: failed to process issue',
          );
        }
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'linear poller: poll failed');
    }
  };

  // Run immediately on start, then on interval
  void poll();
  const handle = setInterval(() => void poll(), intervalMs);

  return () => clearInterval(handle);
}
