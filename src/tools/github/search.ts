import { tool } from 'ai';
import { z } from 'zod';
import type { Octokit } from '@octokit/rest';
import { isAllowedRepo, describeAllowlist, type RepoSpec } from './allowlist.js';

const PER_PAGE = 10;

const inputSchema = z.object({
  owner: z.string().min(1).optional().describe('GitHub repo owner (org or user). Omit to use the configured default.'),
  repo: z.string().min(1).optional().describe('GitHub repo name. Omit to use the configured default.'),
  query: z.string().min(1).describe('Code search query — same syntax as github.com/search?type=code'),
});

type SearchInput = z.infer<typeof inputSchema>;

type SearchResult =
  | { totalCount: number; incompleteResults: boolean; items: Array<{ path: string; repository: string; htmlUrl: string }> }
  | { error: string; message: string };

export interface SearchToolDeps {
  octokit: Octokit;
  defaultRepo?: RepoSpec;
}

/**
 * Resolve the (owner, repo) pair, falling back to the default if either is
 * absent. Returns null if the caller passed neither and there's no default —
 * the tool then surfaces a structured error.
 */
function resolveRepo(input: SearchInput, defaultRepo: RepoSpec | undefined): RepoSpec | null {
  const owner = input.owner ?? defaultRepo?.owner;
  const repo = input.repo ?? defaultRepo?.repo;
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * Core search logic, exported for unit testing without constructing the full
 * AI SDK tool wrapper.
 */
export async function _executeSearch(deps: SearchToolDeps, input: SearchInput): Promise<SearchResult> {
  const target = resolveRepo(input, deps.defaultRepo);
  if (!target) {
    return {
      error: 'no_repo_specified',
      message: `No owner/repo provided and no default configured. Allowed: ${describeAllowlist()}.`,
    };
  }

  const { owner, repo } = target;

  if (!isAllowedRepo(owner, repo)) {
    return {
      error: 'repo_not_allowlisted',
      message: `${owner}/${repo} is not in the allowlist. Allowed: ${describeAllowlist()}.`,
    };
  }

  try {
    const res = await deps.octokit.search.code({
      q: `${input.query} repo:${owner}/${repo}`,
      per_page: PER_PAGE,
    });

    const items = res.data.items.map(item => ({
      path: item.path,
      repository: item.repository.full_name,
      htmlUrl: item.html_url,
    }));

    return {
      totalCount: res.data.total_count,
      incompleteResults: res.data.incomplete_results,
      items,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 403 || status === 429) {
      return { error: 'rate_limited', message: 'GitHub code-search rate limit exceeded; try again in a minute.' };
    }
    if (status === 422) {
      return { error: 'invalid_query', message: 'Query rejected by GitHub. Common causes: query too short, unsupported qualifier.' };
    }
    throw err; // unknown error — let the agent loop see it
  }
}

export function githubSearchCodeTool(deps: SearchToolDeps) {
  const defaultStr = deps.defaultRepo ? ` Default repo: ${deps.defaultRepo.owner}/${deps.defaultRepo.repo}.` : '';
  return tool({
    description:
      'Search code in a GitHub repository. Use for "where is X defined?", "what files import Y?", or "show me usages of Z".' +
      defaultStr +
      ` Allowed repos: ${describeAllowlist()}.`,
    inputSchema,
    execute: (input) => _executeSearch(deps, input),
  });
}
