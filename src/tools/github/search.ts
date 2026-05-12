import { tool } from 'ai';
import { z } from 'zod';
import type { Octokit } from '@octokit/rest';
import { isAllowedRepo, describeAllowlist } from './allowlist.js';

const PER_PAGE = 10;

const inputSchema = z.object({
  owner: z.string().min(1).describe('GitHub repo owner (org or user)'),
  repo: z.string().min(1).describe('GitHub repo name'),
  query: z.string().min(1).describe('Code search query — same syntax as github.com/search?type=code'),
});

type SearchInput = z.infer<typeof inputSchema>;

type SearchResult =
  | { totalCount: number; incompleteResults: boolean; items: Array<{ path: string; repository: string; htmlUrl: string }> }
  | { error: string; message: string };

/**
 * Core search logic, exported for unit testing without constructing the full
 * AI SDK tool wrapper.
 */
export async function _executeSearch(octokit: Octokit, input: SearchInput): Promise<SearchResult> {
  const { owner, repo, query } = input;

  if (!isAllowedRepo(owner, repo)) {
    return {
      error: 'repo_not_allowlisted',
      message: `${owner}/${repo} is not in the allowlist. Allowed: ${describeAllowlist()}.`,
    };
  }

  try {
    const res = await octokit.search.code({
      q: `${query} repo:${owner}/${repo}`,
      per_page: PER_PAGE,
    });

    const items = res.data.items.map(item => ({
      path: item.path,
      repository: item.repository.full_name,
      htmlUrl: item.html_url,
      // Octokit doesn't return text_matches by default; fragment is in
      // item.text_matches when 'text-match' Accept header is sent. We're
      // skipping that for simplicity — file path + URL is enough for
      // Claude to decide whether to fetch the file.
    }));

    return {
      totalCount: res.data.total_count,
      incompleteResults: res.data.incomplete_results,
      items,
    };
  } catch (err: unknown) {
    // GitHub's search API is rate-limited (30/min authenticated). Surface
    // the rate-limit case structurally so Claude can reason about retry.
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

export function githubSearchCodeTool(octokit: Octokit) {
  return tool({
    description:
      'Search code in a GitHub repository. Use for "where is X defined?", "what files import Y?", or "show me usages of Z". ' +
      `Allowed repos: ${describeAllowlist()}.`,
    inputSchema,
    execute: (input) => _executeSearch(octokit, input),
  });
}
