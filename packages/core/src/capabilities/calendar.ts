/**
 * Calendar capability module — private, per-user credentials.
 *
 * Builds calendar_list_events tool when the user has configured
 * Google OAuth credentials. Returns null if credentials are missing/disabled.
 * Shares Google OAuth credentials with the gmail capability.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */
import type { ToolSet } from "ai";
import { google } from "googleapis";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import { calendarListEventsTool } from "../tools/google/calendar.js";
import type { CapabilityConfig, PrivateCapability } from "./types.js";

export const calendarCapability: PrivateCapability = {
  id: "calendar",
  displayName: "Calendar",
  scope: "private",

  fieldSchema: [
    {
      key: "clientId",
      label: "Google OAuth Client ID",
      target: "credentials.clientId",
      placeholder: "...apps.googleusercontent.com",
    },
    {
      key: "clientSecret",
      label: "Google OAuth Client Secret",
      target: "credentials.clientSecret",
      secret: true,
    },
    {
      key: "refreshToken",
      label: "Refresh Token",
      target: "credentials.refreshToken",
      secret: true,
    },
    {
      key: "calendarId",
      label: "Calendar ID",
      target: "settings.calendarId",
      placeholder: "primary",
    },
  ],

  async buildToolsForUser(
    _tinoUserId: string,
    config: CapabilityConfig | null,
    _configStore: ConfigStore,
    logger: AppLogger,
  ): Promise<ToolSet | null> {
    if (!config) {
      return null;
    }

    const { clientId, clientSecret, refreshToken } = config.credentials;
    if (!clientId || !clientSecret || !refreshToken) {
      return null;
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    const tools: ToolSet = {
      calendar_list_events: calendarListEventsTool(auth),
    };

    logger.info({ tinoUserId: _tinoUserId }, "calendar tools enabled");
    return tools;
  },
};
