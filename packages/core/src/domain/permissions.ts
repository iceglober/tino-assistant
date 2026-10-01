/**
 * Who may do what inside an org — the policy, as data.
 *
 * Roles are the org plugin's (`owner` > `admin` > `member`); each inherits the
 * one below. A grant is an action on a resource with a possession:
 *   - `any`: any record of that resource in the org;
 *   - `own`: only records whose `ownerId` is the member's id — enforced by the
 *     engine against the record passed in, not just assumed;
 * and the attributes (fields) the role may see or set, in glob notation, so a
 * member reading the member list gets names and roles but not who connected what.
 *
 * Two gates apply to every check: the member must be `active`, and an org must
 * be `active`. They fail closed — a check without that context is denied.
 *
 * The server loads this into `accesscontrol` (infrastructure/security/access.ts).
 * It lives here, as plain data, so the rule is reviewable in one place and the
 * core keeps no dependencies.
 */

export const ROLES = ["member", "admin", "owner"] as const;
export type OrgRole = (typeof ROLES)[number];

export const RESOURCES = [
  "org", // the org overview and its setup status
  "settings", // org settings, incl. write-only secrets
  "member", // people in the org
  "invitation",
  "accessPolicy", // who may join without an invite
  "slackApp", // the org's Slack app: setup + install
  "googleClient", // the org's Google OAuth client setup
  "mcpServer", // workspace servers (owner: the org) and personal ones (owner: the member)
  "connection", // a member's own Google/Slack tokens
  "chat",
  "knowledge", // private knowledge: own; workspace knowledge: any
  "knowledgeBase", // the org's whole KB (rebuild)
] as const;
export type Resource = (typeof RESOURCES)[number];

export type Possession = "any" | "own";
export type Action = "create" | "read" | "update" | "delete";

export interface Grant {
  role: OrgRole;
  resource: Resource;
  action: `${Action}:${Possession}`;
  attributes: string[];
}

const all = ["*"];

/** Each role's own grants; inheritance adds the grants of the roles below. */
export const GRANTS: readonly Grant[] = [
  // ── member ────────────────────────────────────────────────────────────────
  { role: "member", resource: "org", action: "read:any", attributes: all },
  // A team directory, without what each person has connected or when they joined.
  { role: "member", resource: "member", action: "read:any", attributes: ["id", "name", "email", "role", "status"] },
  { role: "member", resource: "member", action: "read:own", attributes: all },
  { role: "member", resource: "mcpServer", action: "read:any", attributes: ["*", "!token"] },
  { role: "member", resource: "mcpServer", action: "create:own", attributes: all },
  { role: "member", resource: "mcpServer", action: "update:own", attributes: all },
  { role: "member", resource: "mcpServer", action: "delete:own", attributes: all },
  { role: "member", resource: "connection", action: "create:own", attributes: all },
  { role: "member", resource: "connection", action: "delete:own", attributes: all },
  { role: "member", resource: "chat", action: "create:own", attributes: all },
  { role: "member", resource: "knowledge", action: "read:any", attributes: all }, // workspace scope
  { role: "member", resource: "knowledge", action: "read:own", attributes: all }, // private scope
  { role: "member", resource: "knowledge", action: "update:own", attributes: all }, // don't-learn-from

  // ── admin ─────────────────────────────────────────────────────────────────
  { role: "admin", resource: "member", action: "read:any", attributes: all },
  { role: "admin", resource: "member", action: "update:any", attributes: ["role", "status"] },
  { role: "admin", resource: "invitation", action: "create:any", attributes: all },
  { role: "admin", resource: "invitation", action: "read:any", attributes: all },
  { role: "admin", resource: "invitation", action: "delete:any", attributes: all },
  { role: "admin", resource: "accessPolicy", action: "read:any", attributes: all },
  { role: "admin", resource: "accessPolicy", action: "update:any", attributes: all },
  { role: "admin", resource: "settings", action: "read:any", attributes: all },
  { role: "admin", resource: "settings", action: "update:any", attributes: all },
  { role: "admin", resource: "slackApp", action: "read:any", attributes: all },
  { role: "admin", resource: "slackApp", action: "create:any", attributes: all },
  { role: "admin", resource: "googleClient", action: "read:any", attributes: all },
  { role: "admin", resource: "mcpServer", action: "create:any", attributes: all },
  { role: "admin", resource: "mcpServer", action: "update:any", attributes: all },
  { role: "admin", resource: "mcpServer", action: "delete:any", attributes: all },
  { role: "admin", resource: "knowledgeBase", action: "delete:any", attributes: all },

  // ── owner ─────────────────────────────────────────────────────────────────
  // Owners can do everything admins can; the org plugin additionally protects
  // the last owner from being removed or demoted.
];

/** Which role each role inherits. */
export const INHERITS: Readonly<Record<OrgRole, OrgRole | null>> = {
  member: null,
  admin: "member",
  owner: "admin",
};

/** Conditions every check must pass (fail closed when the context lacks them). */
export const GATES = ['$.member.status == "active"', '$.org.status == "active"'] as const;

/** The plugin's role string, narrowed; anything unknown is treated as a plain member. */
export function orgRole(raw: string | null | undefined): OrgRole {
  const first = (raw ?? "").split(",")[0]?.trim();
  return first === "owner" || first === "admin" ? first : "member";
}

/** Owners and admins administer the org. */
export const isAdminRole = (role: OrgRole): boolean => role === "admin" || role === "owner";
