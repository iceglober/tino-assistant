import type { CryptoAdapter, EncryptionContext, EnvelopeCiphertext } from "../crypto/types.js";
import type { ConfigStore } from "../persistence/config.js";
import type { PrivacyConfig, PrivacyConfigDelta } from "./types.js";

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

function diffStringArrays(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before.map((s) => s.toLowerCase()));
  const afterSet = new Set(after.map((s) => s.toLowerCase()));
  return {
    added: after.filter((s) => !beforeSet.has(s.toLowerCase())),
    removed: before.filter((s) => !afterSet.has(s.toLowerCase())),
  };
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
        return JSON.parse(plaintext) as PrivacyConfig;
      } catch {
        return null;
      }
    },

    async set(tinoUserId: string, config: PrivacyConfig): Promise<void> {
      const plaintext = JSON.stringify(config);
      const envelope = await crypto.encrypt(plaintext, encCtx(tinoUserId));
      await configStore.set(configKey(tinoUserId), envelope);
    },

    computeDelta(current: PrivacyConfig | null, proposed: PrivacyConfig): PrivacyConfigDelta {
      const delta: PrivacyConfigDelta = {};

      const curGmail = current?.gmail;
      const propGmail = proposed.gmail;
      if (propGmail) {
        const labels = diffStringArrays(curGmail?.privateLabels ?? [], propGmail.privateLabels);
        const addrs = diffStringArrays(curGmail?.denyListedAddresses ?? [], propGmail.denyListedAddresses);
        if (labels.added.length || labels.removed.length || addrs.added.length || addrs.removed.length) {
          delta.gmail = {
            addedLabels: labels.added,
            removedLabels: labels.removed,
            addedAddresses: addrs.added,
            removedAddresses: addrs.removed,
          };
        }
      }

      const curSlack = current?.slack;
      const propSlack = proposed.slack;
      if (propSlack) {
        const convos = diffStringArrays(curSlack?.denyListedConversationIds ?? [], propSlack.denyListedConversationIds);
        const users = diffStringArrays(curSlack?.denyListedUserIds ?? [], propSlack.denyListedUserIds);
        if (convos.added.length || convos.removed.length || users.added.length || users.removed.length) {
          delta.slack = {
            addedConversationIds: convos.added,
            removedConversationIds: convos.removed,
            addedUserIds: users.added,
            removedUserIds: users.removed,
          };
        }
      }

      const curCal = current?.calendar;
      const propCal = proposed.calendar;
      if (propCal && curCal?.gateAllByDefault !== propCal.gateAllByDefault) {
        delta.calendar = {
          gateAllByDefaultChanged: {
            from: curCal?.gateAllByDefault ?? false,
            to: propCal.gateAllByDefault,
          },
        };
      }

      return delta;
    },

    isAdditive(delta: PrivacyConfigDelta): boolean {
      if (delta.gmail?.addedLabels?.length) return true;
      if (delta.gmail?.addedAddresses?.length) return true;
      if (delta.slack?.addedConversationIds?.length) return true;
      if (delta.slack?.addedUserIds?.length) return true;
      if (delta.calendar?.gateAllByDefaultChanged?.to === true) return true;
      return false;
    },
  };
}
