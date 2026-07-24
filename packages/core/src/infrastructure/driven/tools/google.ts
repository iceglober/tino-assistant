/**
 * Builds the per-user Google tools (Gmail + Calendar) from the user's stored
 * OAuth credentials. Returns {} if the user hasn't connected Google.
 */
import type { ToolSet } from "ai";
import { google } from "googleapis";
import type { CapabilityConfig } from "../../../domain/types.js";
import type { ConfigStore, Logger, UserCapabilityStore } from "../../../ports/outbound.js";
import { calendarListEventsTool } from "./google/calendar.js";
import { gmailGetMessageTool, gmailSearchTool } from "./google/gmail.js";

/** Read a user's stored capability config (encrypted store first, flat config fallback). */
async function readUserCredentials(
  userId: string,
  capabilityId: string,
  configStore: ConfigStore,
  userCapabilities: UserCapabilityStore,
): Promise<CapabilityConfig | null> {
  try {
    const stored = await userCapabilities.get(userId, capabilityId);
    if (stored) return stored;
  } catch {
    /* fall through to config-store fallback */
  }
  const raw = await configStore.get(`user.${userId}.capability.${capabilityId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CapabilityConfig;
  } catch {
    return null;
  }
}

export async function buildGoogleTools(
  userId: string,
  configStore: ConfigStore,
  userCapabilities: UserCapabilityStore,
  logger: Logger,
): Promise<ToolSet> {
  const cfg =
    (await readUserCredentials(userId, "gmail", configStore, userCapabilities)) ??
    (await readUserCredentials(userId, "calendar", configStore, userCapabilities));
  const creds = cfg?.credentials;
  if (!creds?.clientId || !creds?.clientSecret || !creds?.refreshToken) return {};

  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  logger.info({ userId }, "google tools enabled");
  return {
    gmail_search: gmailSearchTool(auth),
    gmail_get_message: gmailGetMessageTool(auth),
    calendar_list_events: calendarListEventsTool(auth),
  };
}
