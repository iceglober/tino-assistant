import { describe, expect, test, vi } from 'vitest';
import { _executeSearch } from '../../src/tools/github/search.js';
import { _executeGetFile } from '../../src/tools/github/getFile.js';
import type { Octokit } from '@octokit/rest';

// ---------------------------------------------------------------------------
// Mock Octokit factory
// ---------------------------------------------------------------------------

const makeOctokit = (overrides: Partial<{
  search: { code: ReturnType<typeof vi.fn> };
  repos: { getContent: ReturnType<typeof vi.fn> };
}> = {}): Octokit => ({
  search: {
    code: vi.fn().mockResolvedValue({
      data: { total_count: 0, incomplete_results: false, items: [] },
    }),
    ...overrides.search,
  },
  repos: {
    getContent: vi.fn().mockResolvedValue({
      data: { type: 'file', content: '', encoding: 'base64', path: '', sha: '', size: 0 },
    }),
    ...overrides.repos,
  },
} as unknown as Octokit);

// ---------------------------------------------------------------------------
// github_search_code tests
// ---------------------------------------------------------------------------

describe('github_search_code', () => {
  test('1. allowlist accept — calls octokit.search.code with correct q param', async () => {
    const codeFn = vi.fn().mockResolvedValue({
      data: {
        total_count: 2,
        incomplete_results: false,
        items: [
          { path: 'src/auth.ts', repository: { full_name: 'kn-eng/kn-eng' }, html_url: 'https://github.com/kn-eng/kn-eng/blob/main/src/auth.ts' },
          { path: 'src/middleware.ts', repository: { full_name: 'kn-eng/kn-eng' }, html_url: 'https://github.com/kn-eng/kn-eng/blob/main/src/middleware.ts' },
        ],
      },
    });
    const octokit = makeOctokit({ search: { code: codeFn } });

    const result = await _executeSearch(octokit, { owner: 'kn-eng', repo: 'kn-eng', query: 'auth middleware' });

    expect(codeFn).toHaveBeenCalledOnce();
    expect(codeFn).toHaveBeenCalledWith({ q: 'auth middleware repo:kn-eng/kn-eng', per_page: 10 });

    expect(result).toMatchObject({
      totalCount: 2,
      incompleteResults: false,
      items: [
        { path: 'src/auth.ts', repository: 'kn-eng/kn-eng', htmlUrl: 'https://github.com/kn-eng/kn-eng/blob/main/src/auth.ts' },
        { path: 'src/middleware.ts', repository: 'kn-eng/kn-eng', htmlUrl: 'https://github.com/kn-eng/kn-eng/blob/main/src/middleware.ts' },
      ],
    });
  });

  test('2. allowlist reject — returns error, octokit.search.code NOT called', async () => {
    const codeFn = vi.fn();
    const octokit = makeOctokit({ search: { code: codeFn } });

    const result = await _executeSearch(octokit, { owner: 'evil-corp', repo: 'secrets', query: 'password' });

    expect(codeFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: 'repo_not_allowlisted' });
  });

  test('3. allowlist case-insensitive — KN-ENG/kn-eng is accepted', async () => {
    const codeFn = vi.fn().mockResolvedValue({
      data: { total_count: 0, incomplete_results: false, items: [] },
    });
    const octokit = makeOctokit({ search: { code: codeFn } });

    const result = await _executeSearch(octokit, { owner: 'KN-ENG', repo: 'kn-eng', query: 'test' });

    expect(codeFn).toHaveBeenCalledOnce();
    expect(result).not.toMatchObject({ error: expect.anything() });
  });

  test('4. rate limit (status 403) → returns { error: "rate_limited" }', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { status: 403 });
    const codeFn = vi.fn().mockRejectedValue(rateLimitErr);
    const octokit = makeOctokit({ search: { code: codeFn } });

    const result = await _executeSearch(octokit, { owner: 'kn-eng', repo: 'kn-eng', query: 'test' });

    expect(result).toMatchObject({ error: 'rate_limited' });
  });

  test('5. invalid query (status 422) → returns { error: "invalid_query" }', async () => {
    const invalidErr = Object.assign(new Error('unprocessable'), { status: 422 });
    const codeFn = vi.fn().mockRejectedValue(invalidErr);
    const octokit = makeOctokit({ search: { code: codeFn } });

    const result = await _executeSearch(octokit, { owner: 'kn-eng', repo: 'kn-eng', query: 'x' });

    expect(result).toMatchObject({ error: 'invalid_query' });
  });
});

// ---------------------------------------------------------------------------
// github_get_file tests
// ---------------------------------------------------------------------------

describe('github_get_file', () => {
  test('6. allowlist accept — calls octokit.repos.getContent, returns decoded content', async () => {
    const fileContent = 'export const hello = "world";';
    const b64 = Buffer.from(fileContent, 'utf8').toString('base64');
    const getContentFn = vi.fn().mockResolvedValue({
      data: {
        type: 'file',
        content: b64,
        encoding: 'base64',
        path: 'src/hello.ts',
        sha: 'abc123',
        size: fileContent.length,
      },
    });
    const octokit = makeOctokit({ repos: { getContent: getContentFn } });

    const result = await _executeGetFile(octokit, { owner: 'kn-eng', repo: 'kn-eng', path: 'src/hello.ts' });

    expect(getContentFn).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      path: 'src/hello.ts',
      sha: 'abc123',
      content: fileContent,
      truncated: false,
    });
  });

  test('7. allowlist reject (getFile) — returns error, no API call', async () => {
    const getContentFn = vi.fn();
    const octokit = makeOctokit({ repos: { getContent: getContentFn } });

    const result = await _executeGetFile(octokit, { owner: 'evil-corp', repo: 'secrets', path: 'passwords.txt' });

    expect(getContentFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: 'repo_not_allowlisted' });
  });

  test('8. truncation — file > 50KB → truncated: true, content.length === 50*1024', async () => {
    const big = 'a'.repeat(60 * 1024);
    const b64 = Buffer.from(big, 'utf8').toString('base64');
    const getContentFn = vi.fn().mockResolvedValue({
      data: {
        type: 'file',
        content: b64,
        encoding: 'base64',
        path: 'big.txt',
        sha: 'def456',
        size: 60 * 1024,
      },
    });
    const octokit = makeOctokit({ repos: { getContent: getContentFn } });

    const result = await _executeGetFile(octokit, { owner: 'kn-eng', repo: 'kn-eng', path: 'big.txt' });

    expect(result).toMatchObject({ truncated: true });
    if ('content' in result) {
      expect(result.content.length).toBe(50 * 1024);
    }
  });

  test('9. no truncation — small file → truncated: false, full content returned', async () => {
    const small = 'hello world';
    const b64 = Buffer.from(small, 'utf8').toString('base64');
    const getContentFn = vi.fn().mockResolvedValue({
      data: {
        type: 'file',
        content: b64,
        encoding: 'base64',
        path: 'small.txt',
        sha: 'ghi789',
        size: small.length,
      },
    });
    const octokit = makeOctokit({ repos: { getContent: getContentFn } });

    const result = await _executeGetFile(octokit, { owner: 'kn-eng', repo: 'kn-eng', path: 'small.txt' });

    expect(result).toMatchObject({ truncated: false, content: small });
  });

  test('10. directory response → returns { error: "is_directory" }', async () => {
    // Octokit returns an array when the path is a directory
    const getContentFn = vi.fn().mockResolvedValue({
      data: [
        { type: 'file', name: 'index.ts', path: 'src/index.ts' },
      ],
    });
    const octokit = makeOctokit({ repos: { getContent: getContentFn } });

    const result = await _executeGetFile(octokit, { owner: 'kn-eng', repo: 'kn-eng', path: 'src' });

    expect(result).toMatchObject({ error: 'is_directory' });
  });

  test('11. 404 → returns { error: "not_found" }', async () => {
    const notFoundErr = Object.assign(new Error('not found'), { status: 404 });
    const getContentFn = vi.fn().mockRejectedValue(notFoundErr);
    const octokit = makeOctokit({ repos: { getContent: getContentFn } });

    const result = await _executeGetFile(octokit, { owner: 'kn-eng', repo: 'kn-eng', path: 'nonexistent.ts' });

    expect(result).toMatchObject({ error: 'not_found' });
  });
});
