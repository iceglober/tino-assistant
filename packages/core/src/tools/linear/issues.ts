import { tool } from 'ai';
import { z } from 'zod';
import type { LinearClient } from '@linear/sdk';

// ---------------------------------------------------------------------------
// Shared result shape
// ---------------------------------------------------------------------------

export interface IssueResult {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  priorityLabel: string;
  assignee?: string;
  labels: string[];
  project?: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helper: resolve an Issue-like object to a flat IssueResult
// The SDK Issue/IssueSearchResult classes have async getters (LinearFetch<T>)
// for related objects. We cast them to Promise<T | undefined> for resolution.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveIssue(issue: any): Promise<IssueResult> {
  // Resolve async getters in parallel
  const [stateObj, assigneeObj, projectObj] = await Promise.all([
    issue.state ? (issue.state as Promise<{ name: string } | undefined>) : Promise.resolve(undefined),
    issue.assignee ? (issue.assignee as Promise<{ displayName: string } | undefined>) : Promise.resolve(undefined),
    issue.project ? (issue.project as Promise<{ name: string } | undefined>) : Promise.resolve(undefined),
  ]);

  // Labels: call the labels() method if available, else fall back to empty
  let labelNames: string[] = [];
  if (typeof issue.labels === 'function') {
    try {
      const labelsConn = await (issue.labels as () => Promise<{ nodes: Array<{ name: string }> }>)();
      labelNames = labelsConn?.nodes?.map((l) => l.name) ?? [];
    } catch {
      labelNames = [];
    }
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    status: stateObj?.name ?? 'Unknown',
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    assignee: assigneeObj?.displayName,
    labels: labelNames,
    project: projectObj?.name,
    url: issue.url,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helper: resolve team key → team ID
// ---------------------------------------------------------------------------

async function resolveTeamId(client: LinearClient, teamKey: string): Promise<string | null> {
  const teams = await client.teams({ filter: { key: { eq: teamKey } } });
  const team = teams.nodes[0];
  return team?.id ?? null;
}

// ---------------------------------------------------------------------------
// Helper: resolve state name → state ID for a given team
// ---------------------------------------------------------------------------

async function resolveStateId(client: LinearClient, teamKey: string, stateName: string): Promise<string | null> {
  const states = await client.workflowStates({
    filter: {
      team: { key: { eq: teamKey } },
      name: { eqIgnoreCase: stateName },
    },
  });
  const state = states.nodes[0];
  return state?.id ?? null;
}

// ---------------------------------------------------------------------------
// 1. linear_search_issues
// ---------------------------------------------------------------------------

const searchIssuesSchema = z.object({
  query: z.string().optional().describe('Text search query. If omitted, uses structured filters only.'),
  teamKey: z.string().optional().describe('Team key prefix, e.g., "GEN". Filters to that team.'),
  status: z.string().optional().describe('Filter by workflow state name, e.g., "In Progress", "Todo".'),
  assignee: z.string().optional().describe('Filter by assignee display name (case-insensitive contains).'),
  limit: z.number().int().min(1).max(50).default(20).describe('Max results to return (1–50, default 20).'),
});

type SearchIssuesInput = z.infer<typeof searchIssuesSchema>;

type SearchIssuesResult =
  | { issues: IssueResult[]; count: number }
  | { error: string; message: string };

export async function _executeSearchIssues(
  client: LinearClient,
  input: SearchIssuesInput,
): Promise<SearchIssuesResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawIssues: any[];

    if (input.query) {
      // Text search path
      const payload = await client.searchIssues(input.query, { first: input.limit });
      rawIssues = payload.nodes;
    } else {
      // Structured filter path
      const filter: Record<string, unknown> = {};
      if (input.teamKey) {
        filter['team'] = { key: { eq: input.teamKey } };
      }
      if (input.status) {
        filter['state'] = { name: { eqIgnoreCase: input.status } };
      }
      if (input.assignee) {
        filter['assignee'] = { displayName: { containsIgnoreCase: input.assignee } };
      }
      const conn = await client.issues({ filter, first: input.limit });
      rawIssues = conn.nodes;
    }

    const issues = await Promise.all(rawIssues.map((i) => resolveIssue(i)));
    return { issues, count: issues.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: 'search_failed', message: msg };
  }
}

export function linearSearchIssuesTool(client: LinearClient) {
  return tool({
    description:
      'Search or filter Linear issues. Provide a text query for full-text search, or use teamKey/status/assignee for structured filtering. Returns a flat list of issues with status, priority, assignee, and URL.',
    inputSchema: searchIssuesSchema,
    execute: (input) => _executeSearchIssues(client, input),
  });
}

// ---------------------------------------------------------------------------
// 2. linear_get_issue
// ---------------------------------------------------------------------------

const getIssueSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID (UUID) or identifier (e.g., "GEN-123").'),
});

type GetIssueInput = z.infer<typeof getIssueSchema>;

type GetIssueResult = IssueResult | { error: string; message: string };

export async function _executeGetIssue(
  client: LinearClient,
  input: GetIssueInput,
): Promise<GetIssueResult> {
  try {
    const issue = await client.issue(input.issueId);
    return await resolveIssue(issue);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: 'get_failed', message: msg };
  }
}

export function linearGetIssueTool(client: LinearClient) {
  return tool({
    description:
      'Get full details for a single Linear issue by ID or identifier (e.g., "GEN-123"). Returns title, description, status, assignee, labels, priority, project, and URL.',
    inputSchema: getIssueSchema,
    execute: (input) => _executeGetIssue(client, input),
  });
}

// ---------------------------------------------------------------------------
// 3. linear_create_issue
// ---------------------------------------------------------------------------

const createIssueSchema = z.object({
  teamKey: z.string().min(1).describe('Team key prefix, e.g., "GEN" for Engineering.'),
  title: z.string().min(1).describe('Issue title.'),
  description: z.string().optional().describe('Issue description in markdown format.'),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low.'),
  assigneeId: z.string().optional().describe('User ID to assign the issue to.'),
  labelIds: z.array(z.string()).optional().describe('Array of label IDs to attach.'),
  projectId: z.string().optional().describe('Project ID to associate the issue with.'),
});

type CreateIssueInput = z.infer<typeof createIssueSchema>;

type CreateIssueResult =
  | { issue: IssueResult }
  | { error: string; message: string };

export async function _executeCreateIssue(
  client: LinearClient,
  input: CreateIssueInput,
): Promise<CreateIssueResult> {
  try {
    const teamId = await resolveTeamId(client, input.teamKey);
    if (!teamId) {
      return {
        error: 'team_not_found',
        message: `No team found with key "${input.teamKey}". Check the team key and try again.`,
      };
    }

    const payload = await client.createIssue({
      teamId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assigneeId: input.assigneeId,
      labelIds: input.labelIds,
      projectId: input.projectId,
    });

    const created = await payload.issue;
    if (!created) {
      return { error: 'create_failed', message: 'Issue was not returned after creation.' };
    }

    const issue = await resolveIssue(created);
    return { issue };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: 'create_failed', message: msg };
  }
}

export function linearCreateIssueTool(client: LinearClient) {
  return tool({
    description:
      'Create a new Linear issue. teamKey is the team prefix (e.g., "GEN" for Engineering). Returns the created issue with its identifier (e.g., "GEN-123").',
    inputSchema: createIssueSchema,
    execute: (input) => _executeCreateIssue(client, input),
  });
}

// ---------------------------------------------------------------------------
// 4. linear_update_issue
// ---------------------------------------------------------------------------

const updateIssueSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID (UUID) or identifier (e.g., "GEN-123").'),
  title: z.string().optional().describe('New title.'),
  description: z.string().optional().describe('New description in markdown format.'),
  stateName: z
    .string()
    .optional()
    .describe('Workflow state name to transition to, e.g., "In Progress", "Done". Resolved to ID automatically.'),
  teamKey: z
    .string()
    .optional()
    .describe('Team key required when using stateName, e.g., "GEN". Defaults to "GEN" if omitted.'),
  assigneeId: z.string().optional().describe('User ID to assign the issue to.'),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low.'),
  labelIds: z.array(z.string()).optional().describe('Replace all labels with this array of label IDs.'),
});

type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

type UpdateIssueResult =
  | { issue: IssueResult }
  | { error: string; message: string };

export async function _executeUpdateIssue(
  client: LinearClient,
  input: UpdateIssueInput,
): Promise<UpdateIssueResult> {
  try {
    let stateId: string | undefined;
    if (input.stateName) {
      const teamKey = input.teamKey ?? 'GEN';
      const resolved = await resolveStateId(client, teamKey, input.stateName);
      if (!resolved) {
        return {
          error: 'state_not_found',
          message: `No workflow state named "${input.stateName}" found for team "${teamKey}".`,
        };
      }
      stateId = resolved;
    }

    const payload = await client.updateIssue(input.issueId, {
      title: input.title,
      description: input.description,
      stateId,
      assigneeId: input.assigneeId,
      priority: input.priority,
      labelIds: input.labelIds,
    });

    const updated = await payload.issue;
    if (!updated) {
      return { error: 'update_failed', message: 'Issue was not returned after update.' };
    }

    const issue = await resolveIssue(updated);
    return { issue };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: 'update_failed', message: msg };
  }
}

export function linearUpdateIssueTool(client: LinearClient) {
  return tool({
    description:
      'Update an existing Linear issue. Any field can be updated independently. Use stateName (e.g., "In Progress", "Done") — it is resolved to a state ID automatically. Provide teamKey when using stateName if the issue is not in the default "GEN" team.',
    inputSchema: updateIssueSchema,
    execute: (input) => _executeUpdateIssue(client, input),
  });
}

// ---------------------------------------------------------------------------
// 5. linear_add_comment
// ---------------------------------------------------------------------------

const addCommentSchema = z.object({
  issueId: z.string().min(1).describe('Issue ID (UUID) or identifier (e.g., "GEN-123").'),
  body: z.string().min(1).describe('Comment body in markdown format.'),
});

type AddCommentInput = z.infer<typeof addCommentSchema>;

type AddCommentResult =
  | { commentId: string; success: boolean }
  | { error: string; message: string };

export async function _executeAddComment(
  client: LinearClient,
  input: AddCommentInput,
): Promise<AddCommentResult> {
  try {
    const payload = await client.createComment({
      issueId: input.issueId,
      body: input.body,
    });

    return {
      commentId: payload.commentId ?? '',
      success: payload.success,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: 'comment_failed', message: msg };
  }
}

export function linearAddCommentTool(client: LinearClient) {
  return tool({
    description:
      'Add a comment to a Linear issue. Use this to report findings, post updates, or ask questions on issues you are working on.',
    inputSchema: addCommentSchema,
    execute: (input) => _executeAddComment(client, input),
  });
}

// ---------------------------------------------------------------------------
// 6. linear_list_my_issues
// ---------------------------------------------------------------------------

const listMyIssuesSchema = z.object({
  status: z
    .string()
    .optional()
    .describe('Filter by workflow state name, e.g., "In Progress", "Todo".'),
  limit: z.number().int().min(1).max(50).default(20).describe('Max results to return (1–50, default 20).'),
});

type ListMyIssuesInput = z.infer<typeof listMyIssuesSchema>;

type ListMyIssuesResult =
  | { issues: IssueResult[]; count: number }
  | { error: string; message: string };

export async function _executeListMyIssues(
  client: LinearClient,
  input: ListMyIssuesInput,
): Promise<ListMyIssuesResult> {
  try {
    const me = await client.viewer;
    const myId = me.id;

    const filter: Record<string, unknown> = {
      assignee: { id: { eq: myId } },
    };

    if (input.status) {
      filter['state'] = { name: { eqIgnoreCase: input.status } };
    }

    const conn = await client.issues({ filter, first: input.limit });
    const issues = await Promise.all(conn.nodes.map((i) => resolveIssue(i)));
    return { issues, count: issues.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: 'list_failed', message: msg };
  }
}

export function linearListMyIssuesTool(client: LinearClient) {
  return tool({
    description:
      'List Linear issues assigned to tino (the current viewer). Use to check what is on your plate. Optionally filter by status name.',
    inputSchema: listMyIssuesSchema,
    execute: (input) => _executeListMyIssues(client, input),
  });
}
