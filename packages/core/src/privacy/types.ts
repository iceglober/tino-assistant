export type ToolResultPlaceholder = {
  type: "redacted";
  reason: "private_event" | "private_folder" | "deny_listed_email" | "deny_listed_dm" | "address_deny_listed";
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
  version: 2;
  email?: EmailPrivacyConfig;
  messaging?: MessagingPrivacyConfig;
  calendar?: CalendarPrivacyConfig;
  lastReviewedAt: number;
}

export interface EmailPrivacyConfig {
  privateFolders: string[];
  denyListedAddresses: string[];
}

export interface MessagingPrivacyConfig {
  denyListedConversationIds: string[];
  denyListedUserIds: string[];
}

export interface CalendarPrivacyConfig {
  defaultVisibility: "default" | "public" | "private";
  gateAllByDefault: boolean;
}

export interface PrivacyConfigDelta {
  email?: {
    addedFolders: string[];
    removedFolders: string[];
    addedAddresses: string[];
    removedAddresses: string[];
  };
  messaging?: {
    addedConversationIds: string[];
    removedConversationIds: string[];
    addedUserIds: string[];
    removedUserIds: string[];
  };
  calendar?: {
    gateAllByDefaultChanged?: { from: boolean; to: boolean };
  };
}

// Domain types for ports/adapters
export interface PrivacyLabel {
  name: string;
  itemCount: number;
}

export interface PrivacyContact {
  address: string;
  displayName?: string;
  itemCount: number;
}

export interface PrivacyConversation {
  id: string;
  participantId?: string;
  participantName?: string;
  itemCount: number;
}

export interface CalendarVisibility {
  defaultVisibility: string;
  calendars: Array<{ id: string; name: string }>;
}
