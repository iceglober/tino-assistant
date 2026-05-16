/**
 * Calendar capability module.
 *
 * Registers calendar_list_events tool.
 * Shares Google OAuth credentials with the gmail capability.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */
import type { ToolSet } from "ai";
import { google } from "googleapis";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import { calendarListEventsTool } from "../tools/google/calendar.js";
import type { CapabilityConfig, CapabilityModule } from "./types.js";

export const calendarCapability: CapabilityModule = {
  id: "calendar",
  displayName: "Calendar",

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

  async registerTools(
    config: CapabilityConfig,
    _configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void> {
    const { clientId, clientSecret, refreshToken } = config.credentials;
    if (!clientId) throw new Error("Calendar capability: credentials.clientId is not set");
    if (!clientSecret) throw new Error("Calendar capability: credentials.clientSecret is not set");
    if (!refreshToken) throw new Error("Calendar capability: credentials.refreshToken is not set");

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    tools.calendar_list_events = calendarListEventsTool(auth);

    logger.info("calendar tools enabled");
  },
};
