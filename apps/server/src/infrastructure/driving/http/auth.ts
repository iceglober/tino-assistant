/**
 * Accounts and sessions, and how a session becomes a member of an org.
 *
 * An *account* (better-auth's `user`) is a person on the platform: an email,
 * a password and/or "Sign in with Google" — tino's own Google client asking
 * for openid/email/profile only, which needs no Google review. Signing in
 * grants no data access; Gmail and Calendar are connected separately, per org,
 * through the org's client (see routes/connections.ts).
 *
 * A *member* (`tino_user`) is that person inside one org. The `orgScope`
 * middleware resolves it by email on every org-scoped request: an invited
 * member is activated, a suspended one refused. Invites and domain joins only
 * ever honour a *verified* email — otherwise anyone could sign up as
 * ceo@yourcompany.com and walk into your org.
 */

import type { OrgMember } from "@tino/contracts";
import type { Logger } from "@tino/core/ports/outbound";
import { type Auth, type BetterAuthOptions, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { MiddlewareHandler } from "hono";
import type { OrgRuntime } from "../../../bootstrap/org-runtime.js";
import type { EmailSender } from "../../driven/email/sender.js";
import type { PgPool } from "../../driven/persistence/db.js";

/** The signed-in platform account. */
export interface Account {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

/** Variables every request may carry. */
export type AccountVariables = { account: Account | null };

/** Variables on org-scoped routes: the member and their org's runtime. */
export type AuthVariables = AccountVariables & {
  user: OrgMember;
  org: OrgRuntime;
};

export interface AuthOptions {
  baseUrl: string;
  secret: string;
  database: PgPool;
  email: EmailSender;
  /** Require the emailed link before sign-in (production). */
  requireEmailVerification: boolean;
  /** Tino's Google client for sign-in only (basic scopes). */
  googleSignIn?: { clientId: string; clientSecret: string };
  /** Extra origins allowed to call the auth API (the Vite dev server). */
  trustedOrigins?: string[];
  logger: Logger;
}

export async function createAuth(opts: AuthOptions): Promise<Auth> {
  const { email, logger } = opts;
  const options: BetterAuthOptions = {
    baseURL: opts.baseUrl,
    basePath: "/api/auth",
    secret: opts.secret,
    database: opts.database,
    trustedOrigins: [opts.baseUrl, ...(opts.trustedOrigins ?? [])],
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
  };

  // Create better-auth's tables before the instance exists, so it never sees an empty schema.
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  const auth = betterAuth(options) as unknown as Auth;
  logger.info({ google: !!opts.googleSignIn, verification: opts.requireEmailVerification }, "auth ready");
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

/**
 * Resolve `:slug` to the org's runtime and the account to a member of it.
 * `trustUnverified` lets local dev skip email verification.
 */
export function orgScope(opts: {
  runtimeBySlug: (slug: string) => Promise<OrgRuntime | null>;
  trustUnverified: boolean;
  logger: Logger;
}): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const account = c.get("account");
    if (!account) return c.json({ error: "unauthorized", message: "sign in required" }, 401);
    const org = await opts.runtimeBySlug(c.req.param("slug") ?? "");
    if (!org) return c.json({ error: "not_found", message: "no such org" }, 404);

    const { users } = org.stores;
    const member = await users.getByEmail(account.email);
    // Same answer for "no such org" and "not yours": slugs aren't secrets, but membership is.
    if (!member) return c.json({ error: "not_found", message: "no such org" }, 404);
    if (member.status === "suspended") {
      return c.json({ error: "forbidden", message: "your access to this org has been revoked" }, 403);
    }
    let current = member;
    if (member.status === "invited") {
      if (!account.emailVerified && !opts.trustUnverified) {
        return c.json({ error: "verify_email", message: "confirm your email address to accept this invite" }, 403);
      }
      current = await users.update(member.id, { status: "active", name: member.name ?? account.name ?? undefined });
      opts.logger.info({ org: org.org.slug, tinoUserId: member.id }, "invite accepted on sign-in");
    }
    c.set("org", org);
    c.set("user", {
      id: current.id,
      email: current.email,
      name: current.name ?? null,
      role: current.role,
      status: current.status,
      slackUserId: current.slackUserId,
    });
    await next();
  };
}

/**
 * Gate a route group to admins. Members get 403; no session gets 401. Used for
 * everything that exposes or changes org-wide settings and secrets.
 */
export const requireAdmin: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return c.json({ error: "forbidden", message: "admins only" }, 403);
  await next();
};
