/**
 * Sender-resolution use-case. Maps an inbound Slack sender to a tino user,
 * provisioning one when access policy allows, and returns a decision. It never
 * talks to Slack directly — the driving adapter presents the rejection message.
 */
import type { ResolveResult } from "../domain/types.js";
import type { SenderResolver } from "../ports/inbound.js";
import type { ConfigStore, IdentityResolver, IdentityStore, Logger, UserStore } from "../ports/outbound.js";

export interface SenderDeps {
  resolver: IdentityResolver;
  users: UserStore;
  identities: IdentityStore;
  config: ConfigStore;
  logger: Logger;
}

function parseConfigJson(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
}

export function createSenderResolver(deps: SenderDeps): SenderResolver {
  const { resolver, users, identities, config, logger } = deps;

  return {
    async resolveSlack(slackUserId: string): Promise<ResolveResult> {
      const existingId = await resolver.resolveSlack(slackUserId);
      if (existingId) {
        const user = await users.get(existingId);
        if (!user) {
          logger.error({ tinoUserId: existingId, slackUserId }, "identity link exists but user record missing");
          return { ok: false, message: "something went wrong resolving your account." };
        }
        if (user.status === "suspended") {
          return { ok: false, message: "your access to tino has been revoked. ask your admin if this is a mistake." };
        }
        if (user.status === "invited") {
          await users.update(existingId, { status: "active" });
          logger.info({ tinoUserId: existingId, slackUserId }, "invited user activated on first DM");
        }
        return { ok: true, userId: existingId };
      }

      const rawMode = await config.get("org.accessControl.mode");
      const orgDomain = parseConfigJson(await config.get("org.accessControl.orgDomain"));

      // Fall back to console.allowedDomain (or CONSOLE_ALLOWED_DOMAIN) so
      // org-domain mode activates automatically when a domain is configured.
      const consoleDomain =
        parseConfigJson(await config.get("console.allowedDomain")) || process.env.CONSOLE_ALLOWED_DOMAIN;
      const effectiveDomain = orgDomain || consoleDomain;

      const mode = rawMode ? (JSON.parse(rawMode) as string) : effectiveDomain ? "org-domain" : "allowlist";

      if (mode === "allowlist") {
        return { ok: false, message: "i don't recognize you. ask your admin to add you to tino." };
      }

      try {
        const newUser = await resolver.provisionFromSlack(slackUserId, { mode: "org-domain", orgDomain: effectiveDomain });
        logger.info({ tinoUserId: newUser.id, slackUserId }, "auto-provisioned user via org-domain");
        return { ok: true, userId: newUser.id };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "unknown_user" || msg === "domain_mismatch") {
          // Bootstrap fallback: exactly one active user without a Slack identity → link them.
          const allUsers = await users.list();
          const unlinkedFromSlack = allUsers.filter((u) => u.status === "active" && !u.slackUserId);
          logger.info(
            { totalUsers: allUsers.length, unlinkedCount: unlinkedFromSlack.length, provisionError: msg },
            "slack provision failed, checking bootstrap fallback",
          );

          if (unlinkedFromSlack.length === 1 && unlinkedFromSlack[0]) {
            const sole = unlinkedFromSlack[0];
            await identities.link({ provider: "slack", externalId: slackUserId, tinoUserId: sole.id, linkedAt: Date.now() });
            await users.update(sole.id, { slackUserId });
            logger.info({ tinoUserId: sole.id, slackUserId }, "linked slack identity to sole unlinked user (bootstrap)");
            return { ok: true, userId: sole.id };
          }

          if (allUsers.length === 0) {
            logger.warn({ slackUserId }, "DM received but no users exist — admin must sign in via console first");
            return { ok: false, message: "tino isn't set up yet. an admin needs to sign in at the console first." };
          }

          return {
            ok: false,
            message: "i couldn't verify your identity. try signing in at the tino console to connect your Slack account.",
          };
        }
        throw err;
      }
    },
  };
}
