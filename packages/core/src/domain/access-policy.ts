/**
 * Who may join an org without an invite. Read identically by every path that
 * can create a member (console sign-in, Slack DM), so the rule lives here once.
 *
 * - `invite-only`: only people an admin invited.
 * - `org-domain`: anyone whose verified email is on `domain` joins as a member.
 */
import type { ConfigStore } from "../ports/outbound.js";

export interface AccessPolicy {
  mode: "org-domain" | "invite-only";
  domain: string | null;
}

export const ACCESS_MODE_KEY = "org.accessControl.mode";
export const ACCESS_DOMAIN_KEY = "org.accessControl.orgDomain";

export async function readAccessPolicy(config: ConfigStore): Promise<AccessPolicy> {
  const rawMode = await config.getTyped<string>(ACCESS_MODE_KEY, "");
  const domain = (await config.getTyped<string>(ACCESS_DOMAIN_KEY, "")) || null;
  const mode = rawMode
    ? rawMode === "org-domain" && domain
      ? "org-domain"
      : "invite-only"
    : domain
      ? "org-domain"
      : "invite-only";
  return { mode, domain };
}

/** True when `email` may join under the policy without an invite. */
export function joinsByDomain(policy: AccessPolicy, email: string): boolean {
  return policy.mode === "org-domain" && !!policy.domain && email.toLowerCase().endsWith(`@${policy.domain}`);
}
