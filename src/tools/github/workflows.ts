import { tool } from 'ai';
import { z } from 'zod';
import type { Octokit } from '@octokit/rest';
import { isAllowedRepo, describeAllowlist, type RepoSpec } from './allowlist.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolveRepo(
  input: { owner?: string; repo?: string },
  defaultRepo: RepoSpec | undefined,
): RepoSpec | null {
  const owner = input.owner ?? defaultRepo?.owner;
  const repo = input.repo ?? defaultRepo?.repo;
  if (!owner || !repo) return null;
  return { owner, repo };
}

// ---------------------------------------------------------------------------
// github_list_workflow_runs
// ---------------------------------------------------------------------------

const listRunsInputSchema = z.object({
  owner: z
    .string()
    .min(1)
    .optional()
    .describe('Repo owner (org or user). Omit to use the configured default.'),
  repo: z
    .string()
    .min(1)
    .optional()
    .describe('Repo name. Omit to use the configured default.'),
  branch: z.string().optional().describe('Filter by branch name'),
  status: z
    .enum([
      'completed',
      'action_required',
      'cancelled',
      'failure',
      'neutral',
      'skipped',
      'stale',
      'success',
      'timed_out',
      'in_progress',
      'queued',
      'requested',
      'waiting',
      'pending',
    ])
    .optional()
    .describe('Filter by run status'),
  perPage: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe('Number of runs to return (1–20, default 10)'),
});

type ListRunsInput = z.infer<typeof listRunsInputSchema>;

interface WorkflowRunSummary {
  id: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  headBranch: string | null;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

type ListRunsResult =
  | { runs: WorkflowRunSummary[]; count: number }
  | { error: string; message: string };

export interface WorkflowToolDeps {
  octokit: Octokit;
  defaultRepo?: RepoSpec;
  allowedRepos: readonly RepoSpec[];
}

export async function _executeListWorkflowRuns(
  deps: WorkflowToolDeps,
  input: ListRunsInput,
): Promise<ListRunsResult> {
  const target = resolveRepo(input, deps.defaultRepo);
  if (!target) {
    return {
      error: 'no_repo_specified',
      message: `No owner/repo provided and no default configured. Allowed: ${describeAllowlist(deps.allowedRepos)}.`,
    };
  }

  const { owner, repo } = target;

  if (!isAllowedRepo(owner, repo, deps.allowedRepos)) {
    return {
      error: 'repo_not_allowlisted',
      message: `${owner}/${repo} is not in the allowlist. Allowed: ${describeAllowlist(deps.allowedRepos)}.`,
    };
  }

  try {
    const res = await deps.octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      branch: input.branch,
      status: input.status,
      per_page: input.perPage,
    });

    const runs: WorkflowRunSummary[] = res.data.workflow_runs.map(run => ({
      id: run.id,
      name: run.name ?? null,
      status: run.status ?? null,
      conclusion: run.conclusion ?? null,
      headBranch: run.head_branch ?? null,
      headSha: run.head_sha,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      htmlUrl: run.html_url,
    }));

    return { runs, count: runs.length };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 403 || status === 429) {
      return { error: 'rate_limited', message: 'GitHub rate limit exceeded; try again in a minute.' };
    }
    if (status === 404) {
      return { error: 'not_found', message: `Repository ${owner}/${repo} not found or no Actions access.` };
    }
    throw err;
  }
}

export function githubListWorkflowRunsTool(deps: WorkflowToolDeps) {
  const defaultStr = deps.defaultRepo
    ? ` Default repo: ${deps.defaultRepo.owner}/${deps.defaultRepo.repo}.`
    : '';
  return tool({
    description:
      'List recent GitHub Actions workflow runs for a repository. ' +
      'Use for "what is the CI status?", "did the last build pass?", "show me failed runs on main". ' +
      `Returns run ID, name, status, conclusion, branch, and URL.${defaultStr} Allowed repos: ${describeAllowlist(deps.allowedRepos)}.`,
    inputSchema: listRunsInputSchema,
    execute: input => _executeListWorkflowRuns(deps, input),
  });
}

// ---------------------------------------------------------------------------
// github_get_workflow_run_logs
// ---------------------------------------------------------------------------

const getRunLogsInputSchema = z.object({
  owner: z
    .string()
    .min(1)
    .optional()
    .describe('Repo owner. Omit to use the configured default.'),
  repo: z
    .string()
    .min(1)
    .optional()
    .describe('Repo name. Omit to use the configured default.'),
  runId: z
    .number()
    .int()
    .describe('Workflow run ID (from github_list_workflow_runs)'),
});

type GetRunLogsInput = z.infer<typeof getRunLogsInputSchema>;

interface StepSummary {
  number: number;
  name: string;
  status: string | null;
  conclusion: string | null;
}

interface AnnotationSummary {
  path: string;
  startLine: number | null;
  endLine: number | null;
  annotationLevel: string | null;
  title: string | null;
  message: string | null;
}

interface JobSummary {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  steps: StepSummary[];
  annotations: AnnotationSummary[];
}

type GetRunLogsResult =
  | { jobs: JobSummary[] }
  | { error: string; message: string };

export async function _executeGetWorkflowRunLogs(
  deps: WorkflowToolDeps,
  input: GetRunLogsInput,
): Promise<GetRunLogsResult> {
  const target = resolveRepo(input, deps.defaultRepo);
  if (!target) {
    return {
      error: 'no_repo_specified',
      message: `No owner/repo provided and no default configured. Allowed: ${describeAllowlist(deps.allowedRepos)}.`,
    };
  }

  const { owner, repo } = target;

  if (!isAllowedRepo(owner, repo, deps.allowedRepos)) {
    return {
      error: 'repo_not_allowlisted',
      message: `${owner}/${repo} is not in the allowlist. Allowed: ${describeAllowlist(deps.allowedRepos)}.`,
    };
  }

  try {
    // 1. List jobs for the run
    const jobsRes = await deps.octokit.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: input.runId,
      filter: 'latest',
    });

    const jobs: JobSummary[] = [];

    for (const job of jobsRes.data.jobs) {
      const steps: StepSummary[] = (job.steps ?? []).map(step => ({
        number: step.number,
        name: step.name,
        status: step.status ?? null,
        conclusion: step.conclusion ?? null,
      }));

      // 2. For failed jobs, fetch annotations
      let annotations: AnnotationSummary[] = [];
      if (job.conclusion === 'failure') {
        try {
          const annotationsRes = await deps.octokit.checks.listAnnotations({
            owner,
            repo,
            check_run_id: job.id,
          });
          annotations = annotationsRes.data.map(a => ({
            path: a.path,
            startLine: a.start_line ?? null,
            endLine: a.end_line ?? null,
            annotationLevel: a.annotation_level ?? null,
            title: a.title ?? null,
            message: a.message,
          }));
        } catch {
          // Annotations are best-effort — don't fail the whole call
          annotations = [];
        }
      }

      jobs.push({
        id: job.id,
        name: job.name,
        status: job.status ?? null,
        conclusion: job.conclusion ?? null,
        steps,
        annotations,
      });
    }

    return { jobs };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 403 || status === 429) {
      return { error: 'rate_limited', message: 'GitHub rate limit exceeded; try again in a minute.' };
    }
    if (status === 404) {
      return { error: 'not_found', message: `Run ${input.runId} not found in ${owner}/${repo}.` };
    }
    throw err;
  }
}

export function githubGetWorkflowRunLogsTool(deps: WorkflowToolDeps) {
  const defaultStr = deps.defaultRepo
    ? ` Default repo: ${deps.defaultRepo.owner}/${deps.defaultRepo.repo}.`
    : '';
  return tool({
    description:
      'Get jobs and failed-step annotations for a GitHub Actions workflow run. ' +
      'Use after github_list_workflow_runs to diagnose a failed build. ' +
      'Returns each job with its steps and any error annotations (file path, line, message). ' +
      `Provide the runId from github_list_workflow_runs.${defaultStr} Allowed repos: ${describeAllowlist(deps.allowedRepos)}.`,
    inputSchema: getRunLogsInputSchema,
    execute: input => _executeGetWorkflowRunLogs(deps, input),
  });
}
