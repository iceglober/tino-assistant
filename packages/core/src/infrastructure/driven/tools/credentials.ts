/**
 * Read a user's stored per-capability config (encrypted UserCapabilityStore
 * first, flat config-store fallback). Shared by the Google and Slack user tools.
 */
import type { CapabilityConfig } from "../../../domain/types.js";
import type { ConfigStore, UserCapabilityStore } from "../../../ports/outbound.js";

export async function readUserCredentials(
  userId: string,
  capabilityId: string,
  configStore: ConfigStore,
  userCapabilities: UserCapabilityStore,
): Promise<CapabilityConfig | null> {
  try {
    const stored = await userCapabilities.get(userId, capabilityId);
    if (stored) return stored;
  } catch {
    /* fall through to config-store fallback */
  }
  const raw = await configStore.get(`user.${userId}.capability.${capabilityId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CapabilityConfig;
  } catch {
    return null;
  }
}
