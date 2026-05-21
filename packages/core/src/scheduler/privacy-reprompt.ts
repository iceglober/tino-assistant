import type { AppLogger } from "../slack/app.js";
import type { PrivacyConfig } from "../privacy/types.js";

const PRIVACY_REGEX = /private|personal|hr|legal|medical|doctor|therapy|family|finance|tax/i;

export interface RepromptSignal {
  type: "new_contact" | "new_dm_participant" | "visibility_change";
  description: string;
}

export interface RepromptDeps {
  userId: string;
  config: PrivacyConfig;
  getRecentEmailContacts?: () => Promise<Array<{ email: string; name?: string }>>;
  getRecentDMs?: () => Promise<Array<{ userId: string; userName: string }>>;
  getCalendarVisibility?: () => Promise<string>;
  logger: AppLogger;
}

export async function checkPrivacyReprompt(deps: RepromptDeps): Promise<RepromptSignal[]> {
  const { config, logger } = deps;
  const signals: RepromptSignal[] = [];

  if (deps.getRecentEmailContacts && config.email) {
    const contacts = await deps.getRecentEmailContacts();
    const denySet = new Set(config.email.denyListedAddresses.map((a) => a.toLowerCase()));
    for (const contact of contacts) {
      const localPart = contact.email.split("@")[0] ?? "";
      if (PRIVACY_REGEX.test(contact.name ?? "") || PRIVACY_REGEX.test(localPart)) {
        if (!denySet.has(contact.email.toLowerCase())) {
          signals.push({
            type: "new_contact",
            description: `New contact "${contact.name ?? contact.email}" matches privacy keywords but isn't in your deny-list`,
          });
        }
      }
    }
  }

  if (deps.getRecentDMs && config.messaging) {
    const dms = await deps.getRecentDMs();
    const denySet = new Set(config.messaging.denyListedUserIds);
    for (const dm of dms) {
      if (PRIVACY_REGEX.test(dm.userName) && !denySet.has(dm.userId)) {
        signals.push({
          type: "new_dm_participant",
          description: `New DM participant "${dm.userName}" matches privacy keywords but isn't in your deny-list`,
        });
      }
    }
  }

  if (deps.getCalendarVisibility && config.calendar) {
    const currentVis = await deps.getCalendarVisibility();
    if (currentVis !== config.calendar.defaultVisibility) {
      signals.push({
        type: "visibility_change",
        description: `Calendar default visibility changed from "${config.calendar.defaultVisibility}" to "${currentVis}"`,
      });
    }
  }

  if (signals.length > 0) {
    logger.info({ userId: deps.userId, signalCount: signals.length }, "privacy re-prompt signals detected");
  }

  return signals;
}
