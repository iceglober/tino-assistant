import { tool } from 'ai';
import { z } from 'zod';
import type { Octokit } from '@octokit/rest';
import { isAllowedRepo, describeAllowlist, type RepoSpec } from './allowlist.js';

const FILE_MAX_BYTES = 50 * 1024; // 50 KB

const inputSchema = z.object({
  owner: z.string().min(1).optional().describe('GitHub repo owner (org or user). Omit to use the configured default.'),
  repo: z.string().min(1).optional().describe('GitHub repo name. Omit to use the configured default.'),
  path: z.string().min(1).describe('File path within the repo, e.g. "src/auth/middleware.ts"'),
  ref: z.string().optional().describe("Branch, tag, or commit SHA. Defaults to the repo's default branch."),
});

type GetFileInput = z.infer<typeof inputSchema>;

type GetFileResult =
  | { path: string; sha: string; size: number; content: string; truncated: boolean }
  | { error: string; message: string };

export interface GetFileToolDeps {
  octokit: Octokit;
  defaultRepo?: RepoSpec;
}

function resolveRepo(input: GetFileInput, defaultRepo: RepoSpec | undefined): RepoSpec | null {
  const owner = input.owner ?? defaultRepo?.owner;
  const repo = input.repo ?? defaultRepo?.repo;
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * Core getFile logic, exported for unit testing without constructing the full
 * AI SDK tool wrapper.
 */
export async function _executeGetFile(deps: GetFileToolDeps, input: GetFileInput): Promise<GetFileResult> {
  const target = resolveRepo(input, deps.defaultRepo);
  if (!target) {
    return {
      error: 'no_repo_specified',
      message: `No owner/repo provided and no default configured. Allowed: ${describeAllowlist()}.`,
    };
  }

  const { owner, repo } = target;
  const { path, ref } = input;

  if (!isAllowedRepo(owner, repo)) {
    return {
      error: 'repo_not_allowlisted',
      message: `${owner}/${repo} is not in the allowlist. Allowed: ${describeAllowlist()}.`,
    };
  }

  try {
    const res = await deps.octokit.repos.getContent({ owner, repo, path, ref });

    // getContent returns a union: file | directory | symlink | submodule.
    // We only handle plain files. Anything else returns a structured error.
    if (Array.isArray(res.data)) {
      return { error: 'is_directory', message: `${path} is a directory; pass a file path.` };
    }
    if (res.data.type !== 'file') {
      return { error: 'unsupported_type', message: `${path} is type=${res.data.type}, not a regular file.` };
    }
    if (typeof res.data.content !== 'string') {
      return { error: 'no_content', message: 'GitHub returned no content for this file.' };
    }

    // GitHub returns base64-encoded content for files <1 MB; larger files require git_blobs API.
    const decoded = Buffer.from(
      res.data.content,
      res.data.encoding === 'base64' ? 'base64' : 'utf8',
    ).toString('utf8');

    const truncated = decoded.length > FILE_MAX_BYTES;
    const content = truncated ? decoded.slice(0, FILE_MAX_BYTES) : decoded;

    return {
      path: res.data.path,
      sha: res.data.sha,
      size: res.data.size,
      content,
      truncated,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 404) {
      return { error: 'not_found', message: `${owner}/${repo}:${path} not found (ref=${ref ?? 'default'}).` };
    }
    if (status === 403 || status === 429) {
      return { error: 'rate_limited', message: 'GitHub rate limit exceeded; try again in a minute.' };
    }
    throw err;
  }
}

export function githubGetFileTool(deps: GetFileToolDeps) {
  const defaultStr = deps.defaultRepo ? ` Default repo: ${deps.defaultRepo.owner}/${deps.defaultRepo.repo}.` : '';
  return tool({
    description:
      'Read the contents of a single file from a GitHub repository. Returns up to 50 KB; if the file is larger, ' +
      `the response includes truncated: true.${defaultStr} Allowed repos: ${describeAllowlist()}.`,
    inputSchema,
    execute: (input) => _executeGetFile(deps, input),
  });
}
