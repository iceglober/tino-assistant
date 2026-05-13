/**
 * GitHub repo allowlist helpers.
 *
 * The allowlist is no longer a module-level constant — it is read from the
 * ConfigStore at tool-construction time and passed into each function.
 * This makes the allowlist runtime-configurable via the web console.
 *
 * Pattern matches src/tools/cloudwatch/validator.ts (allowlist as parameter).
 */
import type { ConfigStore } from '../../persistence/config.js';

export interface RepoSpec {
  readonly owner: string;
  readonly repo: string;
}

/**
 * Read the allowed repos from the config store.
 * Config key: "github.repos" — value is a JSON array of "owner/repo" strings.
 * Falls back to an empty array if not configured.
 */
export function getAllowedRepos(config: ConfigStore): RepoSpec[] {
  const raw = config.getTyped<string[]>('github.repos', []);
  return raw.flatMap(s => {
    const parsed = parseRepoSpec(s);
    return parsed ? [parsed] : [];
  });
}

/**
 * Read the default repo from the config store.
 * Config key: "github.default_repo" — value is a JSON string "owner/repo".
 * Returns undefined if not configured or malformed.
 */
export function getDefaultRepo(config: ConfigStore): RepoSpec | undefined {
  const val = config.getTyped<string | null>('github.default_repo', null);
  if (!val) return undefined;
  return parseRepoSpec(val) ?? undefined;
}

/**
 * True iff (owner, repo) is in the allowlist. Case-insensitive on both fields.
 * The allowlist is passed as a parameter — no module-level constant lookup.
 */
export function isAllowedRepo(
  owner: string,
  repo: string,
  allowedRepos: readonly RepoSpec[],
): boolean {
  const o = owner.toLowerCase();
  const r = repo.toLowerCase();
  return allowedRepos.some(
    spec => spec.owner.toLowerCase() === o && spec.repo.toLowerCase() === r,
  );
}

/** Human-readable list for error messages. */
export function describeAllowlist(allowedRepos: readonly RepoSpec[]): string {
  if (allowedRepos.length === 0)
    return '(none — add via the config console at http://localhost:3001)';
  return allowedRepos.map(s => `${s.owner}/${s.repo}`).join(', ');
}

/**
 * Parse "owner/repo" into a RepoSpec. Returns null on malformed input.
 */
export function parseRepoSpec(ownerSlashRepo: string): RepoSpec | null {
  const parts = ownerSlashRepo.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}
