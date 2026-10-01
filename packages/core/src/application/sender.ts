/**
 * Sender-resolution use-case. Maps an inbound Slack sender to a tino user,
 * provisioning one when access policy allows, and returns a decision. It never
 * talks to Slack directly — the driving adapter presents the rejection message.
 */
import { readAccessPolicy } from "../domain/access-policy.js";
import type { ResolveResult } from "../domain/types.js";
import type { SenderResolver } from "../ports/inbound.js";
import type { ConfigStore, IdentityResolver, Logger, UserStore } from "../ports/outbound.js";

export interface SenderDeps {
  resolver: IdentityResolver;
  users: UserStore;
  config: ConfigStore;
  logger: Logger;
}

export function createSenderResolver(deps: SenderDeps): SenderResolver {
  const { resolver, users, config, logger } = deps;

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

      const policy = await readAccessPolicy(config);

      try {
        // Links an invited/existing account by Slack profile email in either
        // mode; only org-domain mode may create a brand-new account.
        const linked = await resolver.provisionFromSlack(
          slackUserId,
          policy.mode === "invite-only" ? { mode: "allowlist" } : { mode: "org-domain", orgDomain: policy.domain ?? undefined },
        );
        if (linked.status === "suspended") {
          return { ok: false, message: "your access to tino has been revoked. ask your admin if this is a mistake." };
        }
        if (linked.status === "invited") {
          await users.update(linked.id, { status: "active" });
          logger.info({ tinoUserId: linked.id, slackUserId }, "invited user activated on first DM");
        }
        logger.info({ tinoUserId: linked.id, slackUserId, mode: policy.mode }, "slack sender linked to tino user");
        return { ok: true, userId: linked.id };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "unknown_user" || msg === "domain_mismatch") {
          // Never guess who an unverified sender is: linking them to some
          // existing account (say, the only one without a Slack link) would hand
          // a stranger that person's mail and history.
          if ((await users.list()).length === 0) {
            logger.warn({ slackUserId }, "DM received but no users exist — admin must sign in via console first");
            return { ok: false, message: "tino isn't set up yet. an admin needs to sign in at the console first." };
          }
          logger.info({ slackUserId, mode: policy.mode, reason: msg }, "slack sender not admitted");
          return policy.mode === "invite-only"
            ? { ok: false, message: "i don't recognize you. ask your admin to invite you to tino." }
            : {
                ok: false,
                message:
                  "i couldn't match your Slack account to anyone allowed to use tino. ask your admin to invite your Slack email.",
              };
        }
        throw err;
      }
    },
  };
}
