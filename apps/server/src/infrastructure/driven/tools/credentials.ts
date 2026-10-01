/**
 * Read a user's stored per-capability credentials from the encrypted
 * UserCapabilityStore. Shared by the Google and Slack user tools and KB sources.
 */
import type { CapabilityConfig } from "@tino/core/domain/types";
import type { UserCapabilityStore } from "@tino/core/ports/outbound";

export async function readUserCredentials(
  userId: string,
  capabilityId: string,
  userCapabilities: UserCapabilityStore,
): Promise<CapabilityConfig | null> {
  try {
    return await userCapabilities.get(userId, capabilityId);
  } catch {
    return null;
  }
}
