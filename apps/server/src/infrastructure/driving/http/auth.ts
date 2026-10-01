/**
 * Accounts, sessions, orgs and invitations — all better-auth.
 *
 * An *account* (better-auth `user`) is a person on the platform: email +
 * password, a magic link, or "Sign in with Google" on tino's own client with
 * openid/email/profile only (no Google review needed). Signing in grants no
 * data access; Gmail and Calendar are connected per org (routes/connections.ts).
 *
 * Orgs, memberships and invitations are better-auth's organization plugin:
 * `organization`, `member` (role owner/admin/member, plus tino's `status` and
 * `slackUserId`) and `invitation`. Tino's own tables hang off `organization`
 * with ON DELETE CASCADE, so deleting an org deletes its data.
 *
 * Invites and domain joins only ever honour a *verified* email — otherwise
 * anyone could sign up as ceo@yourcompany.com and walk into your org.
 */

import type { OrgMember } from "@tino/contracts";
import { orgSlugProblem } from "@tino/core/domain/org";
import { type Action, type OrgRole, orgRole, type Possession, type Resource } from "@tino/core/domain/permissions";
import type { Logger } from "@tino/core/ports/outbound";
import { type Auth, type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { magicLink, organization } from "better-auth/plugins";
import type { Context, MiddlewareHandler } from "hono";
import type { OrgRuntime } from "../../../bootstrap/org-runtime.js";
import type { EmailSender } from "../../driven/email/sender.js";
import type { PgPool } from "../../driven/persistence/db.js";
import { type AccessDecision, type AccessSubject, createAccess } from "../../security/access.js";
import { type OrgAdmin, OrgAdminError } from "./org-admin.js";

/** The signed-in platform account. */
export interface Account {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

/** Variables every request may carry. */
export type AccountVariables = { account: Account | null };

/** Variables on org-scoped routes: the member, their org-plugin role, and their org's runtime. */
export type AuthVariables = AccountVariables & {
  user: OrgMember;
  role: OrgRole;
  org: OrgRuntime;
};

export interface AuthOptions {
  baseUrl: string;
  secret: string;
  database: PgPool;
  email: EmailSender;
  /** Require a verified email before sign-in and before accepting an invitation (production). */
  requireEmailVerification: boolean;
  /** Tino's Google client for sign-in only (basic scopes). */
  googleSignIn?: { clientId: string; clientSecret: string };
  /** Closed beta: who may create orgs. */
  canCreateOrg?: (email: string) => boolean;
  /** Extra origins allowed to call the auth API (the Vite dev server). */
  trustedOrigins?: string[];
  logger: Logger;
}

/** Tino's fields on the org plugin's tables. Server-set only (`input: false`). */
const ORG_SCHEMA = {
  organization: {
    additionalFields: {
      slackTeamId: { type: "string", required: false, input: false },
      status: { type: "string", required: false, defaultValue: "active", input: false },
    },
  },
  member: {
    additionalFields: {
      status: { type: "string", required: false, defaultValue: "active", input: false },
      slackUserId: { type: "string", required: false, input: false },
    },
  },
} as const;

/** better-auth's configuration — built once, used to migrate and then to construct the instance. */
export function buildAuthOptions(opts: AuthOptions): BetterAuthOptions {
  const { email, baseUrl } = opts;
  const canCreateOrg = opts.canCreateOrg ?? (() => true);
  return {
    baseURL: baseUrl,
    basePath: "/api/auth",
    secret: opts.secret,
    database: opts.database,
    trustedOrigins: [baseUrl, ...(opts.trustedOrigins ?? [])],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: opts.requireEmailVerification,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        await email.send({
          to: user.email,
          subject: "Reset your Tino password",
          text: `Someone asked to reset the password for ${user.email} on Tino. If it was you:\n\n${url}\n\nIf not, ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await email.send({
          to: user.email,
          subject: "Confirm your email for Tino",
          text: `Confirm ${user.email} to finish setting up Tino:\n\n${url}\n\nThe link expires in an hour.`,
        });
      },
    },
    socialProviders: opts.googleSignIn
      ? { google: { clientId: opts.googleSignIn.clientId, clientSecret: opts.googleSignIn.clientSecret } }
      : undefined,
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    plugins: [
      organization({
        schema: ORG_SCHEMA,
        creatorRole: "owner",
        allowUserToCreateOrganization: (user) =>
          canCreateOrg(user.email) && (!opts.requireEmailVerification || !!user.emailVerified),
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: opts.requireEmailVerification,
        organizationHooks: {
          beforeCreateOrganization: async ({ organization: org }) => {
            const problem = org.slug ? orgSlugProblem(org.slug) : "a URL name is required";
            if (problem) throw new APIError("BAD_REQUEST", { message: problem });
          },
        },
        sendInvitationEmail: async ({ email: to, organization: org, inviter }) => {
          const by = inviter.user.name || inviter.user.email;
          await email.send({
            to,
            subject: `${by} invited you to ${org.name} on Tino`,
            text: `${by} invited you to ${org.name}'s Tino — your team's assistant in Slack.\n\nSign up or sign in with this address to join:\n${baseUrl}/signup?email=${encodeURIComponent(to)}&org=${org.slug}\n\nThe invitation expires in a week.`,
          });
        },
      }),
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email: to, url }) => {
          await email.send({
            to,
            subject: "Your Tino sign-in link",
            text: `Sign in to Tino:\n\n${url}\n\nThe link works once and expires in 15 minutes.`,
          });
        },
      }),
    ],
  };
}

/** Create or upgrade better-auth's tables. Runs before tino's schema, which references them. */
export async function migrateAuth(options: BetterAuthOptions): Promise<void> {
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
}

export function createAuth(options: BetterAuthOptions, logger: Logger): Auth {
  const auth = betterAuth(options) as unknown as Auth;
  logger.info(
    { google: !!options.socialProviders, verification: !!options.emailAndPassword?.requireEmailVerification },
    "auth ready",
  );
  return auth;
}

/** Attach the signed-in account (or null) to every request. */
export function sessionMiddleware(auth: Auth): MiddlewareHandler<{ Variables: AccountVariables }> {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null);
    c.set(
      "account",
      session
        ? {
            id: session.user.id,
            email: session.user.email.toLowerCase(),
            name: session.user.name || null,
            emailVerified: !!session.user.emailVerified,
          }
        : null,
    );
    await next();
  };
}

/** 401 unless signed in. */
export const requireAccount: MiddlewareHandler<{ Variables: AccountVariables }> = async (c, next) => {
  if (!c.get("account")) return c.json({ error: "unauthorized", message: "sign in required" }, 401);
  await next();
};

const access = createAccess();

/**
 * Resolve `:slug` to the org's runtime and the account to a member of it. An
 * account with a pending invitation accepts it here, through the org plugin
 * (which insists on a verified email in production), so following the invite
 * email and signing up is all a person has to do. `trustUnverified` lets local
 * dev skip verification.
 */
export function orgScope(opts: {
  runtimeBySlug: (slug: string) => Promise<OrgRuntime | null>;
  orgAdmin: OrgAdmin;
  trustUnverified: boolean;
  logger: Logger;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const account = c.get("account");
    if (!account) return c.json({ error: "unauthorized", message: "sign in required" }, 401);
    const org = await opts.runtimeBySlug(c.req.param("slug") ?? "");
    if (!org) return c.json({ error: "not_found", message: "no such org" }, 404);

    const { users, invitations } = org.stores;
    let member = await users.getByEmail(account.email);
    if (!member) {
      const invite = await invitations.pendingFor(account.email);
      if (invite) {
        if (!account.emailVerified && !opts.trustUnverified) {
          return c.json({ error: "verify_email", message: "confirm your email address to accept this invite" }, 403);
        }
        try {
          await opts.orgAdmin.acceptInvitation(c.req.raw.headers, invite.id);
          opts.logger.info({ org: org.org.slug, invitation: invite.id }, "invitation accepted");
        } catch (err) {
          const status = err instanceof OrgAdminError ? err.status : 500;
          return c.json({ error: "invitation", message: (err as Error).message }, status);
        }
        member = await users.getByEmail(account.email);
      }
    }
    // Same answer for "no such org" and "not yours": slugs aren't secrets, but membership is.
    if (!member) return c.json({ error: "not_found", message: "no such org" }, 404);
    if (member.status === "suspended") {
      return c.json({ error: "forbidden", message: "your access to this org has been revoked" }, 403);
    }
    c.set("org", org);
    c.set("role", orgRole(member.orgRole ?? member.role));
    c.set("user", {
      id: member.id,
      email: member.email,
      name: member.name ?? account.name ?? null,
      role: member.role,
      status: member.status,
      slackUserId: member.slackUserId,
    });
    await next();
  };
}

/** The access-policy subject for the current request. */
function subjectOf(c: Context<{ Variables: AuthVariables }>): AccessSubject {
  return {
    memberId: c.get("user").id,
    role: c.get("role"),
    status: c.get("user").status,
    orgStatus: c.get("org").org.status,
  };
}

/**
 * Ask the policy (core/domain/permissions.ts) about this request. `record`
 * carries `ownerId` for `own` checks; the decision's `filter` trims a record to
 * the fields the role may see.
 */
export function permit(
  c: Context<{ Variables: AuthVariables }>,
  action: Action,
  resource: Resource,
  possession: Possession = "any",
  record?: object,
): AccessDecision {
  return access.check(subjectOf(c), action, resource, possession, record);
}

/** Route guard: 403 unless the policy grants `action` on `resource`. */
export function authorize(
  action: Action,
  resource: Resource,
  possession: Possession = "any",
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    if (!c.get("user")) return c.json({ error: "unauthorized" }, 401);
    if (!permit(c, action, resource, possession).granted) {
      return c.json({ error: "forbidden", message: "admins only" }, 403);
    }
    await next();
  };
}
