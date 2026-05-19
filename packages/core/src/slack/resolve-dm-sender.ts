import type { AuditLogger } from "../audit/logger.js";
import type { ConfigStore } from "../persistence/config.js";
import type { IdentityResolver } from "../identity/resolver.js";
import type { UserStore } from "../identity/store.js";
import type { AppLogger } from "./app.js";

export interface ResolveDmSenderOpts {
  identityResolver: IdentityResolver;
  users: UserStore;
  configStore: ConfigStore;
  say: (args: { text: string }) => Promise<unknown>;
  auditLogger?: AuditLogger;
  logger: AppLogger;
}

export async function resolveDmSender(
  slackUserId: string,
  opts: ResolveDmSenderOpts,
): Promise<string | null> {
  const { identityResolver, users, configStore, say, auditLogger, logger } = opts;

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

  const raw = await configStore.get("org.accessControl.mode");
  const mode = raw ? (JSON.parse(raw) as string) : "allowlist";

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

  const rawDomain = await configStore.get("org.accessControl.orgDomain");
  const orgDomain = rawDomain ? (JSON.parse(rawDomain) as string) : undefined;

  try {
    const newUser = await identityResolver.provisionFromSlack(slackUserId, { mode: "org-domain", orgDomain });
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
      await say({
        text: "i don't recognize you and your email domain doesn't match the configured org. ask your admin to add you to tino.",
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
