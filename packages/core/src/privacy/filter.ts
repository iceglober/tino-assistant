import { calendarFilter } from "./calendar.js";
import { gmailFilter } from "./gmail.js";
import { slackFilter } from "./slack.js";
import type { CapabilityFilter, Decision, PrivacyConfig } from "./types.js";

const PRIVATE_CAPABILITIES: Record<string, CapabilityFilter> = {
  calendar: calendarFilter as CapabilityFilter,
  gmail: gmailFilter as CapabilityFilter,
  "slack-personal": slackFilter as CapabilityFilter,
};

export const TOOL_TO_CAPABILITY: Record<string, string> = {
  calendar_list_events: "calendar",
  gmail_search: "gmail",
  gmail_get_message: "gmail",
  slack_list_dms: "slack-personal",
  slack_read_dm: "slack-personal",
  slack_read_thread: "slack-personal",
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
      : capId === "gmail"
        ? opts.config.gmail
        : capId === "slack-personal"
          ? opts.config.slack
          : undefined
    : undefined;

  return filter(opts.toolArgs, opts.toolResult, capConfig);
}

export function isPrivateCapability(toolName: string): boolean {
  return toolName in TOOL_TO_CAPABILITY;
}
