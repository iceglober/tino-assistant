import type { PrivacyConfig, PrivacyConfigDelta } from "./types.js";

export function diffStringArrays(
  before: string[],
  after: string[],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before.map((s) => s.toLowerCase()));
  const afterSet = new Set(after.map((s) => s.toLowerCase()));
  return {
    added: after.filter((s) => !beforeSet.has(s.toLowerCase())),
    removed: before.filter((s) => !afterSet.has(s.toLowerCase())),
  };
}

export function computeDelta(
  current: PrivacyConfig | null,
  proposed: PrivacyConfig,
): PrivacyConfigDelta {
  const delta: PrivacyConfigDelta = {};

  const curEmail = current?.email;
  const propEmail = proposed.email;
  if (propEmail) {
    const folders = diffStringArrays(curEmail?.privateFolders ?? [], propEmail.privateFolders);
    const addrs = diffStringArrays(
      curEmail?.denyListedAddresses ?? [],
      propEmail.denyListedAddresses,
    );
    if (
      folders.added.length ||
      folders.removed.length ||
      addrs.added.length ||
      addrs.removed.length
    ) {
      delta.email = {
        addedFolders: folders.added,
        removedFolders: folders.removed,
        addedAddresses: addrs.added,
        removedAddresses: addrs.removed,
      };
    }
  }

  const curMessaging = current?.messaging;
  const propMessaging = proposed.messaging;
  if (propMessaging) {
    const convos = diffStringArrays(
      curMessaging?.denyListedConversationIds ?? [],
      propMessaging.denyListedConversationIds,
    );
    const users = diffStringArrays(
      curMessaging?.denyListedUserIds ?? [],
      propMessaging.denyListedUserIds,
    );
    if (
      convos.added.length ||
      convos.removed.length ||
      users.added.length ||
      users.removed.length
    ) {
      delta.messaging = {
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
}

export function isAdditive(delta: PrivacyConfigDelta): boolean {
  if (delta.email?.addedFolders?.length) return true;
  if (delta.email?.addedAddresses?.length) return true;
  if (delta.messaging?.addedConversationIds?.length) return true;
  if (delta.messaging?.addedUserIds?.length) return true;
  if (delta.calendar?.gateAllByDefaultChanged?.to === true) return true;
  return false;
}
