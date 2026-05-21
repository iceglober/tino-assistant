import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "../crypto/types.js";
import type { ConfigStore } from "../persistence/config.js";
import type { PrivacyConfig, PrivacyConfigDelta } from "./types.js";
import { computeDelta, isAdditive } from "./config-utils.js";

export interface PrivacyConfigStore {
  get(tinoUserId: string): Promise<PrivacyConfig | null>;
  set(tinoUserId: string, config: PrivacyConfig): Promise<void>;
  computeDelta(current: PrivacyConfig | null, proposed: PrivacyConfig): PrivacyConfigDelta;
  isAdditive(delta: PrivacyConfigDelta): boolean;
}

function encCtx(userId: string): EncryptionContext {
  return { userId, capabilityId: "privacy_config", fieldName: "config" };
}

function configKey(userId: string): string {
  return `user.${userId}.privacy_config`;
}

interface V1Config {
  version: 1;
  gmail?: { privateLabels: string[]; denyListedAddresses: string[]; threadingMode: "conservative" };
  slack?: { denyListedConversationIds: string[]; denyListedUserIds: string[]; multiPartyMode: "conservative" };
  calendar?: { defaultVisibility: string; gateAllByDefault: boolean };
  lastReviewedAt: number;
  lastRepromptAt: number | null;
}

function migrateV1(v1: V1Config): PrivacyConfig {
  const config: PrivacyConfig = {
    version: 2,
    lastReviewedAt: v1.lastReviewedAt,
  };

  if (v1.gmail) {
    config.email = {
      privateFolders: v1.gmail.privateLabels,
      denyListedAddresses: v1.gmail.denyListedAddresses,
    };
  }

  if (v1.slack) {
    config.messaging = {
      denyListedConversationIds: v1.slack.denyListedConversationIds,
      denyListedUserIds: v1.slack.denyListedUserIds,
    };
  }

  if (v1.calendar) {
    const vis = v1.calendar.defaultVisibility === "confidential" ? "private" : v1.calendar.defaultVisibility;
    config.calendar = {
      defaultVisibility: vis as "default" | "public" | "private",
      gateAllByDefault: v1.calendar.gateAllByDefault,
    };
  }

  return config;
}

export function createPrivacyConfigStore(deps: {
  configStore: ConfigStore;
  crypto: CryptoAdapter;
}): PrivacyConfigStore {
  const { configStore, crypto } = deps;

  return {
    async get(tinoUserId: string): Promise<PrivacyConfig | null> {
      const raw = await configStore.get(configKey(tinoUserId));
      if (!raw) return null;
      try {
        const envelope = JSON.parse(raw) as EnvelopeCiphertext;
        const plaintext = await crypto.decrypt(envelope, encCtx(tinoUserId));
        const parsed = JSON.parse(plaintext) as PrivacyConfig | V1Config;
        if (parsed.version === 1) return migrateV1(parsed as V1Config);
        return parsed as PrivacyConfig;
      } catch {
        return null;
      }
    },

    async set(tinoUserId: string, config: PrivacyConfig): Promise<void> {
      const plaintext = JSON.stringify(config);
      const envelope = await crypto.encrypt(plaintext, encCtx(tinoUserId));
      await configStore.set(configKey(tinoUserId), envelope);
    },

    computeDelta,
    isAdditive,
  };
}
