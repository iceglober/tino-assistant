import type { TinoUser } from "./types.js";
import type { AppLogger } from "../slack/app.js";
import type { IdentityStore, UserStore } from "./store.js";

export interface SlackWebClient {
  users: {
    info(args: { user: string }): Promise<{
      user?: { profile?: { email?: string } };
    }>;
  };
}

export type ProvisionMode = "allowlist" | "org-domain";

export interface ProvisionOpts {
  mode: ProvisionMode;
  orgDomain?: string;
}

export interface IdentityResolver {
  resolveSlack(slackUserId: string): Promise<string | null>;
  resolveGoogle(email: string): Promise<string | null>;
  provisionFromSlack(slackUserId: string, opts: ProvisionOpts): Promise<TinoUser>;
}

export interface IdentityResolverOpts {
  users: UserStore;
  identities: IdentityStore;
  slackClient: SlackWebClient;
  logger: AppLogger;
}

export function createIdentityResolver(opts: IdentityResolverOpts): IdentityResolver {
  const { users, identities, slackClient, logger } = opts;

  return {
    resolveSlack(slackUserId: string): Promise<string | null> {
      return identities.resolve("slack", slackUserId);
    },

    resolveGoogle(email: string): Promise<string | null> {
      return identities.resolve("google", email.toLowerCase());
    },

    async provisionFromSlack(slackUserId: string, provisionOpts: ProvisionOpts): Promise<TinoUser> {
      const existingId = await identities.resolve("slack", slackUserId);
      if (existingId) {
        const existing = await users.get(existingId);
        if (existing) return existing;
      }

      if (provisionOpts.mode === "allowlist") {
        throw new Error("unknown_user");
      }

      const resp = await slackClient.users.info({ user: slackUserId });
      const email = resp.user?.profile?.email;
      if (!email) {
        logger.warn({ slackUserId }, "slack users.info returned no email — bot may need users:read.email scope");
        throw new Error("unknown_user");
      }

      const normalizedEmail = email.toLowerCase();

      // Link to existing user by email (regardless of domain).
      // The user was already provisioned through another channel (e.g. Google SSO).
      const existingByEmail = await users.getByEmail(normalizedEmail);
      if (existingByEmail) {
        await identities.link({
          provider: "slack",
          externalId: slackUserId,
          tinoUserId: existingByEmail.id,
          linkedAt: Date.now(),
        });
        const merged = await users.update(existingByEmail.id, { slackUserId });
        logger.info({ tinoUserId: existingByEmail.id, email: normalizedEmail, mergedProvider: "slack" }, "linked slack identity to existing user by email");
        return merged;
      }

      // Also check for an existing Google identity with this email
      const existingGoogleId = await identities.resolve("google", normalizedEmail);
      if (existingGoogleId) {
        await identities.link({
          provider: "slack",
          externalId: slackUserId,
          tinoUserId: existingGoogleId,
          linkedAt: Date.now(),
        });
        const merged = await users.update(existingGoogleId, { slackUserId });
        logger.info({ tinoUserId: existingGoogleId, mergedProvider: "slack" }, "merged identity into existing user");
        return merged;
      }

      // New user — domain check gates account creation
      const emailDomain = email.split("@")[1]?.toLowerCase();
      const orgDomain = provisionOpts.orgDomain?.toLowerCase();
      if (!emailDomain || !orgDomain || emailDomain !== orgDomain) {
        throw new Error("domain_mismatch");
      }

      const tinoUserId = crypto.randomUUID();
      const now = Date.now();
      const newUser = await users.create({
        id: tinoUserId,
        email: normalizedEmail,
        name: undefined,
        role: "member",
        status: "active",
        slackUserId,
        createdAt: now,
        updatedAt: now,
      });

      await identities.link({ provider: "slack", externalId: slackUserId, tinoUserId, linkedAt: now });
      await identities.link({ provider: "google", externalId: normalizedEmail, tinoUserId, linkedAt: now });

      logger.info({ tinoUserId, slackUserId }, "provisioned new user from slack");
      return newUser;
    },
  };
}
