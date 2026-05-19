export type ToolResultPlaceholder = {
  type: "redacted";
  reason: "private_event" | "private_label" | "deny_listed_thread" | "deny_listed_dm" | "address_deny_listed";
  metadata: {
    eventId?: string;
    startsAt?: string;
    endsAt?: string;
    durationMin?: number;
    threadId?: string;
    receivedAt?: string;
    labelHash?: string;
    channelId?: string;
    ts?: string;
  };
};

export type Decision = { persist: true } | { persist: false; placeholder: ToolResultPlaceholder };

export interface CapabilityFilter {
  (toolArgs: unknown, toolResult: unknown, config: unknown): Decision;
}

export interface PrivacyConfig {
  version: 1;
  gmail?: GmailPrivacyConfig;
  slack?: SlackPrivacyConfig;
  calendar?: CalendarPrivacyConfig;
  lastReviewedAt: number;
  lastRepromptAt: number | null;
}

export interface GmailPrivacyConfig {
  privateLabels: string[];
  denyListedAddresses: string[];
  threadingMode: "conservative";
}

export interface SlackPrivacyConfig {
  denyListedConversationIds: string[];
  denyListedUserIds: string[];
  multiPartyMode: "conservative";
}

export interface CalendarPrivacyConfig {
  defaultVisibility: "default" | "public" | "private" | "confidential";
  gateAllByDefault: boolean;
}

export interface PrivacyConfigDelta {
  gmail?: {
    addedLabels: string[];
    removedLabels: string[];
    addedAddresses: string[];
    removedAddresses: string[];
  };
  slack?: {
    addedConversationIds: string[];
    removedConversationIds: string[];
    addedUserIds: string[];
    removedUserIds: string[];
  };
  calendar?: {
    gateAllByDefaultChanged?: { from: boolean; to: boolean };
  };
}
