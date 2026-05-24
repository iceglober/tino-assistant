import type { AuditLogger } from "../audit/logger.js";
import type { ConfigStore } from "../persistence/config.js";
import type { IdentityResolver } from "../identity/resolver.js";
import type { IdentityStore, UserStore } from "../identity/store.js";
import type { AppLogger } from "./app.js";

export interface ResolveDmSenderOpts {
  identityResolver: IdentityResolver;
  users: UserStore;
  identities: IdentityStore;
  configStore: ConfigStore;
  say: (args: { text: string }) => Promise<unknown>;
  auditLogger?: AuditLogger;
  logger: AppLogger;
}

function parseConfigJson(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
}

export async function resolveDmSender(
  slackUserId: string,
  opts: ResolveDmSenderOpts,
): Promise<string | null> {
  const { identityResolver, users, identities, configStore, say, auditLogger, logger } = opts;

  const existingId = await identityResolver.resolveSlack(slackUserId);
  if (existingId) {
    const user = await users.get(existingId);
    if (!user) {
      logger.error({ tinoUserId: existingId, slackUserId }, "identity link exists but user record missing");
      return null;
    }

    if (user.status === "suspended") {
      await say({ text: "your access to tino has been revoked. ask your admin if this is a mistake." });
      await auditLogger?.log({ userId: existingId, action: "login", status: "denied", errorMessage: "suspended" });
      return null;
    }

    if (user.status === "invited") {
      await users.update(existingId, { status: "active" });
      logger.info({ tinoUserId: existingId, slackUserId }, "invited user activated on first DM");
    }

    return existingId;
  }

  const rawMode = await configStore.get("org.accessControl.mode");
  const rawDomain = await configStore.get("org.accessControl.orgDomain");
  const orgDomain = parseConfigJson(rawDomain);

  // Fall back to console.allowedDomain (set via CONSOLE_ALLOWED_DOMAIN env var
  // or the config store) so org-domain mode activates automatically when an
  // allowed domain is configured — no separate access-control setup needed.
  const consoleDomain = parseConfigJson(await configStore.get("console.allowedDomain"));
  const effectiveDomain = orgDomain || consoleDomain;

  const mode = rawMode ? (JSON.parse(rawMode) as string) : (effectiveDomain ? "org-domain" : "allowlist");

  if (mode === "allowlist") {
    await say({ text: "i don't recognize you. ask your admin to add you to tino." });
    await auditLogger?.log({
      userId: `UNKNOWN_SLACK:${slackUserId}`,
      action: "login",
      status: "denied",
      errorMessage: `unknown slack user ${slackUserId}`,
    });
    return null;
  }

  try {
    const newUser = await identityResolver.provisionFromSlack(slackUserId, { mode: "org-domain", orgDomain: effectiveDomain });
    await auditLogger?.log({
      userId: newUser.id,
      action: "login",
      status: "success",
      errorMessage: "auto-provisioned via org-domain",
    });
    logger.info({ tinoUserId: newUser.id, slackUserId }, "auto-provisioned user via org-domain");
    return newUser.id;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "unknown_user" || msg === "domain_mismatch") {
      // Bootstrap fallback: if there's exactly one active user without a Slack
      // identity, link them. Covers the case where the admin's Slack and Google
      // emails are on different domains.
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
        await auditLogger?.log({ userId: sole.id, action: "login", status: "success", errorMessage: "bootstrap slack link" });
        return sole.id;
      }

      if (allUsers.length === 0) {
        logger.warn({ slackUserId }, "DM received but no users exist — admin must sign in via console first");
        await say({ text: "tino isn't set up yet. an admin needs to sign in at the console first." });
        await auditLogger?.log({
          userId: `UNKNOWN_SLACK:${slackUserId}`,
          action: "login",
          status: "denied",
          errorMessage: "no users exist",
        });
        return null;
      }

      await say({
        text: "i couldn't verify your identity. try signing in at the tino console to connect your Slack account.",
      });
      await auditLogger?.log({
        userId: `UNKNOWN_SLACK:${slackUserId}`,
        action: "login",
        status: "denied",
        errorMessage: msg,
      });
      return null;
    }
    throw err;
  }
}
