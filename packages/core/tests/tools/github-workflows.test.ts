import { describe, it, expect, vi } from 'vitest';
import {
  _executeListWorkflowRuns,
  _executeGetWorkflowRunLogs,
} from '../../src/tools/github/workflows.js';
import type { Octokit } from '@octokit/rest';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

const makeOctokit = (overrides: {
  listWorkflowRunsForRepo?: ReturnType<typeof vi.fn>;
  listJobsForWorkflowRun?: ReturnType<typeof vi.fn>;
  listAnnotations?: ReturnType<typeof vi.fn>;
} = {}): Octokit =>
  ({
    actions: {
      listWorkflowRunsForRepo:
        overrides.listWorkflowRunsForRepo ??
        vi.fn().mockResolvedValue({ data: { workflow_runs: [] } }),
      listJobsForWorkflowRun:
        overrides.listJobsForWorkflowRun ??
        vi.fn().mockResolvedValue({ data: { jobs: [] } }),
    },
    checks: {
      listAnnotations:
        overrides.listAnnotations ??
        vi.fn().mockResolvedValue({ data: [] }),
    },
  }) as unknown as Octokit;

const allowedRepo = { owner: 'kn-eng', repo: 'kn-eng' };
const ALLOWED_REPOS = [allowedRepo] as const;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeRun = (id: number, overrides: Partial<{
  name: string;
  status: string;
  conclusion: string;
  head_branch: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}> = {}) => ({
  id,
  name: overrides.name ?? `Run ${id}`,
  status: overrides.status ?? 'completed',
  conclusion: overrides.conclusion ?? 'success',
  head_branch: overrides.head_branch ?? 'main',
  head_sha: overrides.head_sha ?? 'abc123',
  created_at: overrides.created_at ?? '2026-05-01T10:00:00Z',
  updated_at: overrides.updated_at ?? '2026-05-01T10:05:00Z',
  html_url: overrides.html_url ?? `https://github.com/kn-eng/kn-eng/actions/runs/${id}`,
});

const makeJob = (id: number, overrides: Partial<{
  name: string;
  status: string;
  conclusion: string;
  steps: Array<{ number: number; name: string; status: string; conclusion: string }>;
}> = {}) => ({
  id,
  name: overrides.name ?? `Job ${id}`,
  status: overrides.status ?? 'completed',
  conclusion: overrides.conclusion ?? 'success',
  steps: overrides.steps ?? [],
});

const makeAnnotation = (overrides: Partial<{
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: string;
  title: string;
  message: string;
}> = {}) => ({
  path: overrides.path ?? 'src/index.ts',
  start_line: overrides.start_line ?? 10,
  end_line: overrides.end_line ?? 10,
  annotation_level: overrides.annotation_level ?? 'failure',
  title: overrides.title ?? 'Test failed',
  message: overrides.message ?? 'Expected true to be false',
});

// ---------------------------------------------------------------------------
// github_list_workflow_runs tests
// ---------------------------------------------------------------------------

describe('_executeListWorkflowRuns', () => {
  // 1. Happy path — returns 2 runs with correct shape
  it('returns runs with correct shape', async () => {
    const run1 = makeRun(1001, { name: 'CI', conclusion: 'success' });
    const run2 = makeRun(1002, { name: 'CI', conclusion: 'failure' });
    const listFn = vi.fn().mockResolvedValue({
      data: { workflow_runs: [run1, run2] },
    });
    const octokit = makeOctokit({ listWorkflowRunsForRepo: listFn });

    const result = await _executeListWorkflowRuns(
      { octokit, defaultRepo: allowedRepo, allowedRepos: ALLOWED_REPOS },
      { perPage: 10 },
    );

    expect('runs' in result).toBe(true);
    if (!('runs' in result)) return;

    expect(result.count).toBe(2);
    expect(result.runs[0]).toMatchObject({
      id: 1001,
      name: 'CI',
      conclusion: 'success',
      headBranch: 'main',
    });
    expect(result.runs[1]).toMatchObject({
      id: 1002,
      conclusion: 'failure',
    });
  });

  // 2. Allowlist reject — non-allowlisted repo → error, no API call
  it('returns error for non-allowlisted repo without calling API', async () => {
    const listFn = vi.fn();
    const octokit = makeOctokit({ listWorkflowRunsForRepo: listFn });

    const result = await _executeListWorkflowRuns(
      { octokit, allowedRepos: ALLOWED_REPOS },
      { owner: 'evil-corp', repo: 'secrets', perPage: 10 },
    );

    expect(listFn).not.toHaveBeenCalled();
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toBe('repo_not_allowlisted');
  });

  // 3. Default repo fallback — no owner/repo → uses default
  it('uses default repo when owner/repo are omitted', async () => {
    const listFn = vi.fn().mockResolvedValue({ data: { workflow_runs: [] } });
    const octokit = makeOctokit({ listWorkflowRunsForRepo: listFn });

    const result = await _executeListWorkflowRuns(
      { octokit, defaultRepo: allowedRepo, allowedRepos: ALLOWED_REPOS },
      { perPage: 5 },
    );

    expect(listFn).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'kn-eng', repo: 'kn-eng', per_page: 5 }),
    );
    expect('runs' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// github_get_workflow_run_logs tests
// ---------------------------------------------------------------------------

describe('_executeGetWorkflowRunLogs', () => {
  // 4. Happy path — 1 failed job with 2 annotations
  it('returns failed job with annotations', async () => {
    const failedJob = makeJob(9001, { name: 'test', conclusion: 'failure', steps: [
      { number: 1, name: 'Checkout', status: 'completed', conclusion: 'success' },
      { number: 2, name: 'Run tests', status: 'completed', conclusion: 'failure' },
    ]});
    const ann1 = makeAnnotation({ path: 'src/auth.ts', start_line: 42, message: 'Assertion failed' });
    const ann2 = makeAnnotation({ path: 'src/utils.ts', start_line: 7, message: 'TypeError: undefined' });

    const listJobsFn = vi.fn().mockResolvedValue({ data: { jobs: [failedJob] } });
    const listAnnotationsFn = vi.fn().mockResolvedValue({ data: [ann1, ann2] });
    const octokit = makeOctokit({
      listJobsForWorkflowRun: listJobsFn,
      listAnnotations: listAnnotationsFn,
    });

    const result = await _executeGetWorkflowRunLogs(
      { octokit, defaultRepo: allowedRepo, allowedRepos: ALLOWED_REPOS },
      { runId: 1234 },
    );

    expect('jobs' in result).toBe(true);
    if (!('jobs' in result)) return;

    expect(result.jobs).toHaveLength(1);
    const job = result.jobs[0]!;
    expect(job.name).toBe('test');
    expect(job.conclusion).toBe('failure');
    expect(job.steps).toHaveLength(2);
    expect(job.steps[1]).toMatchObject({ name: 'Run tests', conclusion: 'failure' });
    expect(job.annotations).toHaveLength(2);
    expect(job.annotations[0]).toMatchObject({ path: 'src/auth.ts', message: 'Assertion failed' });
    expect(job.annotations[1]).toMatchObject({ path: 'src/utils.ts', message: 'TypeError: undefined' });

    // Annotations were fetched for the failed job
    expect(listAnnotationsFn).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 9001 }),
    );
  });

  // 5. All jobs passed — annotations array is empty
  it('returns empty annotations when all jobs succeeded', async () => {
    const successJob = makeJob(9002, { conclusion: 'success' });
    const listJobsFn = vi.fn().mockResolvedValue({ data: { jobs: [successJob] } });
    const listAnnotationsFn = vi.fn();
    const octokit = makeOctokit({
      listJobsForWorkflowRun: listJobsFn,
      listAnnotations: listAnnotationsFn,
    });

    const result = await _executeGetWorkflowRunLogs(
      { octokit, defaultRepo: allowedRepo, allowedRepos: ALLOWED_REPOS },
      { runId: 5678 },
    );

    expect('jobs' in result).toBe(true);
    if (!('jobs' in result)) return;

    expect(result.jobs[0]!.annotations).toEqual([]);
    // Should NOT call listAnnotations for a successful job
    expect(listAnnotationsFn).not.toHaveBeenCalled();
  });

  // 6. Allowlist reject
  it('returns error for non-allowlisted repo without calling API', async () => {
    const listJobsFn = vi.fn();
    const octokit = makeOctokit({ listJobsForWorkflowRun: listJobsFn });

    const result = await _executeGetWorkflowRunLogs(
      { octokit, allowedRepos: ALLOWED_REPOS },
      { owner: 'evil-corp', repo: 'secrets', runId: 999 },
    );

    expect(listJobsFn).not.toHaveBeenCalled();
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toBe('repo_not_allowlisted');
  });
});
