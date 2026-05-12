/**
 * Repos the GitHub tools are permitted to read.
 *
 * Adding a new repo is a deliberate code change — there is no env-var or
 * runtime override. This makes "what does the agent have access to?" a
 * git-blame-able question, not a config-spelunking question.
 *
 * Pattern matches `src/tools/cloudwatch/allowlist.ts` (Phase 5).
 */
export interface RepoSpec {
  readonly owner: string;
  readonly repo: string;
}

export const ALLOWED_REPOS: readonly RepoSpec[] = [
  { owner: 'kn-eng', repo: 'kn-eng' },
];

/** True iff (owner, repo) is in the allowlist. Case-insensitive on both fields. */
export function isAllowedRepo(owner: string, repo: string): boolean {
  const o = owner.toLowerCase();
  const r = repo.toLowerCase();
  return ALLOWED_REPOS.some(spec => spec.owner.toLowerCase() === o && spec.repo.toLowerCase() === r);
}

/** Human-readable list for error messages. */
export function describeAllowlist(): string {
  if (ALLOWED_REPOS.length === 0) return '(none — edit src/tools/github/allowlist.ts to enable)';
  return ALLOWED_REPOS.map(s => `${s.owner}/${s.repo}`).join(', ');
}

/**
 * Parse "owner/repo" into a RepoSpec. Returns null on malformed input.
 * The env schema enforces the regex up front, so this is mostly a
 * type-safety convenience for callers that already have a validated string.
 */
export function parseRepoSpec(ownerSlashRepo: string): RepoSpec | null {
  const parts = ownerSlashRepo.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}
