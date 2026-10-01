/**
 * Each person's "don't learn from" list, kept in their UserCapabilityStore
 * settings (not the config table, which admins can read in full).
 */
import { type DontLearnFrom, NOTHING_EXCLUDED, parseDontLearnFrom } from "@tino/core/domain/dont-learn-from";
import type { DontLearnFromStore, UserCapabilityStore } from "@tino/core/ports/outbound";

const CAPABILITY_ID = "kb.dont-learn-from";

export function createDontLearnFromStore(caps: UserCapabilityStore): DontLearnFromStore {
  return {
    async get(userId) {
      const stored = await caps.get(userId, CAPABILITY_ID).catch(() => null);
      if (!stored) return NOTHING_EXCLUDED;
      const parsed = parseDontLearnFrom(stored.settings);
      return typeof parsed === "string" ? NOTHING_EXCLUDED : parsed;
    },
    async set(userId, value: DontLearnFrom) {
      await caps.set(userId, CAPABILITY_ID, { enabled: true, credentials: {}, settings: { gmail: value.gmail } });
    },
  };
}
