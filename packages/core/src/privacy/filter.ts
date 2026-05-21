import { calendarFilter } from "./calendar-filter.js";
import { emailFilter } from "./email-filter.js";
import { messagingFilter } from "./messaging-filter.js";
import type { CapabilityFilter, Decision, PrivacyConfig } from "./types.js";

const PRIVATE_CAPABILITIES: Record<string, CapabilityFilter> = {
  calendar: calendarFilter as CapabilityFilter,
  email: emailFilter as CapabilityFilter,
  messaging: messagingFilter as CapabilityFilter,
};

export const TOOL_TO_CAPABILITY: Record<string, string> = {
  calendar_list_events: "calendar",
  gmail_search: "email",
  gmail_get_message: "email",
  slack_list_dms: "messaging",
  slack_read_dm: "messaging",
};

export function evaluate(opts: {
  capabilityId?: string;
  toolName: string;
  toolArgs: unknown;
  toolResult: unknown;
  config: PrivacyConfig | null;
}): Decision {
  const capId = opts.capabilityId ?? TOOL_TO_CAPABILITY[opts.toolName];
  if (!capId) return { persist: true };

  const filter = PRIVATE_CAPABILITIES[capId];
  if (!filter) return { persist: true };

  const capConfig = opts.config
    ? capId === "calendar"
      ? opts.config.calendar
      : capId === "email"
        ? opts.config.email
        : capId === "messaging"
          ? opts.config.messaging
          : undefined
    : undefined;

  return filter(opts.toolArgs, opts.toolResult, capConfig);
}

export function isPrivateCapability(toolName: string): boolean {
  return toolName in TOOL_TO_CAPABILITY;
}
