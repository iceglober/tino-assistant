import { describe, expect, test, vi } from 'vitest';
import {
  _executeSearchIssues,
  _executeGetIssue,
  _executeCreateIssue,
  _executeUpdateIssue,
  _executeAddComment,
  _executeListMyIssues,
} from '../../src/tools/linear/issues.js';
import type { LinearClient } from '@linear/sdk';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock Issue-like object. The SDK uses async getters (LinearFetch<T>)
 * for related objects — we simulate them as Promises.
 */
function makeMockIssue(overrides: Partial<{
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  priorityLabel: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  stateName: string;
  assigneeName: string | null;
  projectName: string | null;
  labelNames: string[];
}> = {}) {
  const {
    id = 'issue-uuid-1',
    identifier = 'GEN-1',
    title = 'Test issue',
    description = 'A test issue',
    priority = 2,
    priorityLabel = 'High',
    url = 'https://linear.app/test/issue/GEN-1',
    createdAt = new Date('2026-01-01T00:00:00Z'),
    updatedAt = new Date('2026-01-02T00:00:00Z'),
    stateName = 'In Progress',
    assigneeName = 'Alice',
    projectName = 'Alpha',
    labelNames = ['bug', 'backend'],
  } = overrides;

  return {
    id,
    identifier,
    title,
    description,
    priority,
    priorityLabel,
    url,
    createdAt,
    updatedAt,
    // Async getters — return Promises (LinearFetch is thenable)
    state: Promise.resolve(stateName ? { name: stateName } : undefined),
    assignee: Promise.resolve(assigneeName ? { displayName: assigneeName } : undefined),
    project: Promise.resolve(projectName ? { name: projectName } : undefined),
    labels: () => Promise.resolve({ nodes: labelNames.map((name) => ({ name })) }),
  };
}

/**
 * Build a minimal LinearClient mock. Only the methods used by the tools are
 * mocked; everything else is left undefined.
 */
function makeClient(overrides: Partial<{
  searchIssues: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  issue: ReturnType<typeof vi.fn>;
  createIssue: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  teams: ReturnType<typeof vi.fn>;
  workflowStates: ReturnType<typeof vi.fn>;
  viewer: unknown;
}> = {}): LinearClient {
  return {
    searchIssues: overrides.searchIssues ?? vi.fn().mockResolvedValue({ nodes: [] }),
    issues: overrides.issues ?? vi.fn().mockResolvedValue({ nodes: [] }),
    issue: overrides.issue ?? vi.fn().mockResolvedValue(makeMockIssue()),
    createIssue: overrides.createIssue ?? vi.fn(),
    updateIssue: overrides.updateIssue ?? vi.fn(),
    createComment: overrides.createComment ?? vi.fn(),
    teams: overrides.teams ?? vi.fn().mockResolvedValue({ nodes: [] }),
    workflowStates: overrides.workflowStates ?? vi.fn().mockResolvedValue({ nodes: [] }),
    viewer: overrides.viewer ?? Promise.resolve({ id: 'tino-user-id', displayName: 'tino' }),
  } as unknown as LinearClient;
}

// ---------------------------------------------------------------------------
// 1. linear_search_issues — happy path (text query)
// ---------------------------------------------------------------------------

describe('linear_search_issues', () => {
  test('1. happy path — text query returns 2 issues with flat shape', async () => {
    const issue1 = makeMockIssue({ id: 'id-1', identifier: 'GEN-1', title: 'Auth bug' });
    const issue2 = makeMockIssue({ id: 'id-2', identifier: 'GEN-2', title: 'Login fix', assigneeName: null, projectName: null, labelNames: [] });

    const searchIssuesFn = vi.fn().mockResolvedValue({ nodes: [issue1, issue2] });
    const client = makeClient({ searchIssues: searchIssuesFn });

    const result = await _executeSearchIssues(client, { query: 'auth', limit: 20 });

    expect(searchIssuesFn).toHaveBeenCalledOnce();
    expect(searchIssuesFn).toHaveBeenCalledWith('auth', { first: 20 });

    expect(result).toMatchObject({
      count: 2,
      issues: [
        {
          id: 'id-1',
          identifier: 'GEN-1',
          title: 'Auth bug',
          status: 'In Progress',
          priority: 2,
          priorityLabel: 'High',
          assignee: 'Alice',
          labels: ['bug', 'backend'],
          project: 'Alpha',
          url: 'https://linear.app/test/issue/GEN-1',
        },
        {
          id: 'id-2',
          identifier: 'GEN-2',
          title: 'Login fix',
          assignee: undefined,
          labels: [],
          project: undefined,
        },
      ],
    });
  });

  test('2. empty results — returns { issues: [], count: 0 }', async () => {
    const client = makeClient({
      searchIssues: vi.fn().mockResolvedValue({ nodes: [] }),
    });

    const result = await _executeSearchIssues(client, { query: 'nonexistent', limit: 20 });

    expect(result).toEqual({ issues: [], count: 0 });
  });

  test('3. structured filter — uses issues() not searchIssues()', async () => {
    const issue = makeMockIssue({ identifier: 'GEN-5', title: 'Infra task' });
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [issue] });
    const searchFn = vi.fn();
    const client = makeClient({ issues: issuesFn, searchIssues: searchFn });

    const result = await _executeSearchIssues(client, { teamKey: 'GEN', status: 'Todo', limit: 10 });

    expect(searchFn).not.toHaveBeenCalled();
    expect(issuesFn).toHaveBeenCalledOnce();
    expect(issuesFn).toHaveBeenCalledWith({
      filter: {
        team: { key: { eq: 'GEN' } },
        state: { name: { eqIgnoreCase: 'Todo' } },
      },
      first: 10,
    });
    expect(result).toMatchObject({ count: 1 });
  });
});

// ---------------------------------------------------------------------------
// 4. linear_get_issue — happy path
// ---------------------------------------------------------------------------

describe('linear_get_issue', () => {
  test('4. happy path — resolves all fields including assignee, labels, project', async () => {
    const issue = makeMockIssue({
      id: 'abc-123',
      identifier: 'GEN-42',
      title: 'Fix the thing',
      description: 'Detailed description',
      stateName: 'Done',
      assigneeName: 'Bob',
      projectName: 'Beta',
      labelNames: ['frontend'],
    });

    const issueFn = vi.fn().mockResolvedValue(issue);
    const client = makeClient({ issue: issueFn });

    const result = await _executeGetIssue(client, { issueId: 'GEN-42' });

    expect(issueFn).toHaveBeenCalledWith('GEN-42');
    expect(result).toMatchObject({
      id: 'abc-123',
      identifier: 'GEN-42',
      title: 'Fix the thing',
      description: 'Detailed description',
      status: 'Done',
      assignee: 'Bob',
      labels: ['frontend'],
      project: 'Beta',
    });
  });
});

// ---------------------------------------------------------------------------
// 5. linear_create_issue — happy path
// ---------------------------------------------------------------------------

describe('linear_create_issue', () => {
  test('5. happy path — resolves team key to ID, returns created issue', async () => {
    const teamId = 'ded72ec9-d5ea-4d9b-9814-d23b55fe01e5';
    const createdIssue = makeMockIssue({ identifier: 'GEN-100', title: 'New feature' });

    const teamsFn = vi.fn().mockResolvedValue({ nodes: [{ id: teamId, key: 'GEN' }] });
    const createIssueFn = vi.fn().mockResolvedValue({
      success: true,
      issue: Promise.resolve(createdIssue),
      issueId: createdIssue.id,
    });
    const client = makeClient({ teams: teamsFn, createIssue: createIssueFn });

    const result = await _executeCreateIssue(client, {
      teamKey: 'GEN',
      title: 'New feature',
      description: 'Feature description',
      priority: 2,
    });

    expect(teamsFn).toHaveBeenCalledWith({ filter: { key: { eq: 'GEN' } } });
    expect(createIssueFn).toHaveBeenCalledWith(
      expect.objectContaining({ teamId, title: 'New feature', priority: 2 }),
    );
    expect(result).toMatchObject({ issue: { identifier: 'GEN-100', title: 'New feature' } });
  });

  test('6. unknown team — returns structured error', async () => {
    const teamsFn = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueFn = vi.fn();
    const client = makeClient({ teams: teamsFn, createIssue: createIssueFn });

    const result = await _executeCreateIssue(client, { teamKey: 'UNKNOWN', title: 'Oops' });

    expect(createIssueFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: 'team_not_found' });
  });
});

// ---------------------------------------------------------------------------
// 6. linear_update_issue — happy path
// ---------------------------------------------------------------------------

describe('linear_update_issue', () => {
  test('7. happy path — resolves state name to ID, calls updateIssue', async () => {
    const stateId = 'state-uuid-done';
    const updatedIssue = makeMockIssue({ identifier: 'GEN-10', stateName: 'Done' });

    const workflowStatesFn = vi.fn().mockResolvedValue({
      nodes: [{ id: stateId, name: 'Done' }],
    });
    const updateIssueFn = vi.fn().mockResolvedValue({
      success: true,
      issue: Promise.resolve(updatedIssue),
    });
    const client = makeClient({ workflowStates: workflowStatesFn, updateIssue: updateIssueFn });

    const result = await _executeUpdateIssue(client, {
      issueId: 'GEN-10',
      stateName: 'Done',
      teamKey: 'GEN',
    });

    expect(workflowStatesFn).toHaveBeenCalledWith({
      filter: {
        team: { key: { eq: 'GEN' } },
        name: { eqIgnoreCase: 'Done' },
      },
    });
    expect(updateIssueFn).toHaveBeenCalledWith(
      'GEN-10',
      expect.objectContaining({ stateId }),
    );
    expect(result).toMatchObject({ issue: { identifier: 'GEN-10', status: 'Done' } });
  });
});

// ---------------------------------------------------------------------------
// 7. linear_add_comment — happy path
// ---------------------------------------------------------------------------

describe('linear_add_comment', () => {
  test('8. happy path — calls createComment with issueId and body', async () => {
    const createCommentFn = vi.fn().mockResolvedValue({
      success: true,
      commentId: 'comment-uuid-1',
    });
    const client = makeClient({ createComment: createCommentFn });

    const result = await _executeAddComment(client, {
      issueId: 'GEN-42',
      body: 'Found the root cause: missing null check.',
    });

    expect(createCommentFn).toHaveBeenCalledWith({
      issueId: 'GEN-42',
      body: 'Found the root cause: missing null check.',
    });
    expect(result).toMatchObject({ commentId: 'comment-uuid-1', success: true });
  });
});

// ---------------------------------------------------------------------------
// 8. linear_list_my_issues — happy path
// ---------------------------------------------------------------------------

describe('linear_list_my_issues', () => {
  test('9. happy path — uses viewer ID to filter, returns issues', async () => {
    const myId = 'a5d913e3-7f31-48d5-bf13-4958b9c0c534';
    const issue = makeMockIssue({ identifier: 'GEN-7', title: 'My task' });

    const issuesFn = vi.fn().mockResolvedValue({ nodes: [issue] });
    const client = makeClient({
      viewer: Promise.resolve({ id: myId, displayName: 'tino' }),
      issues: issuesFn,
    });

    const result = await _executeListMyIssues(client, { limit: 20 });

    expect(issuesFn).toHaveBeenCalledWith({
      filter: { assignee: { id: { eq: myId } } },
      first: 20,
    });
    expect(result).toMatchObject({ count: 1, issues: [{ identifier: 'GEN-7', title: 'My task' }] });
  });

  test('10. with status filter — adds state filter to query', async () => {
    const myId = 'tino-id';
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
    const client = makeClient({
      viewer: Promise.resolve({ id: myId }),
      issues: issuesFn,
    });

    await _executeListMyIssues(client, { status: 'In Progress', limit: 10 });

    expect(issuesFn).toHaveBeenCalledWith({
      filter: {
        assignee: { id: { eq: myId } },
        state: { name: { eqIgnoreCase: 'In Progress' } },
      },
      first: 10,
    });
  });
});
