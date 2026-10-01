/**
 * Builds the per-user Google tools (Gmail + Calendar) from the user's stored
 * OAuth credentials. Returns {} if the user hasn't connected Google.
 */

import type { Logger, UserCapabilityStore } from "@tino/core/ports/outbound";
import type { ToolSet } from "ai";
import { google } from "googleapis";
import { readUserCredentials } from "./credentials.js";
import { calendarListEventsTool } from "./google/calendar.js";
import { gmailGetMessageTool, gmailSearchTool } from "./google/gmail.js";

export async function buildGoogleTools(
  userId: string,
  userCapabilities: UserCapabilityStore,
  logger: Logger,
): Promise<ToolSet> {
  const cfg =
    (await readUserCredentials(userId, "gmail", userCapabilities)) ??
    (await readUserCredentials(userId, "calendar", userCapabilities));
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
