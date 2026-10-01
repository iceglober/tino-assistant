/**
 * Orgs: the tenant. One org is one company using tino: its members, its Slack
 * workspace, its own OAuth clients and model keys, and everything indexed from
 * them. Nothing crosses from one org to another — the stores an org's runtime
 * receives are bound to its id, so code below the composition root cannot
 * name another org even by mistake.
 */

export interface Org {
  id: string;
  /** URL handle: tino.app/<slug>. Lowercase letters, digits, dashes. */
  slug: string;
  name: string;
  status: "active" | "suspended";
  /** The Slack workspace this org installed its Slack app into, once it has. */
  slackTeamId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Slugs that would collide with the app's own routes. */
const RESERVED_SLUGS = new Set([
  "slug-available",
  "api",
  "app",
  "assets",
  "auth",
  "account",
  "admin",
  "help",
  "login",
  "logout",
  "new",
  "oauth",
  "onboarding",
  "settings",
  "signin",
  "signup",
  "slack",
  "static",
  "tino",
  "www",
]);

/** A human-readable problem with a slug, or null when it is usable. */
export function orgSlugProblem(slug: string): string | null {
  if (slug.length < 3 || slug.length > 32) return "use 3–32 characters";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return "use lowercase letters, digits, and dashes (not at the start or end)";
  }
  if (slug.includes("--")) return "use single dashes";
  if (RESERVED_SLUGS.has(slug)) return "that name is reserved";
  return null;
}

/** "Acme, Inc." → "acme-inc". May still need a suffix to be unique. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "org"}-team`.slice(0, 32);
}

/**
 * The owner id an org's own records are stored under where a store is keyed by
 * user (workspace MCP servers, encrypted org settings). User ids are UUIDs, so
 * this can never collide with a person.
 */
export const orgOwnerId = (orgId: string): string => `org:${orgId}`;

/**
 * Settings whose values are secrets: OAuth client secrets, tokens, API keys.
 * They are encrypted at rest and write-only through the API — the console
 * learns only whether one is set.
 */
export function isSecretConfigKey(key: string): boolean {
  const last = key.split(".").pop() ?? key;
  return /(secret|token|apikey|password|privatekey)$/i.test(last);
}
