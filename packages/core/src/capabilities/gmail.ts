/**
 * Gmail capability module — private, per-user credentials.
 *
 * Builds gmail_search, gmail_get_message tools when the user has configured
 * Google OAuth credentials. Returns null if credentials are missing/disabled.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */
import type { ToolSet } from "ai";
import { google } from "googleapis";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import { gmailGetMessageTool, gmailSearchTool } from "../tools/google/gmail.js";
import type { CapabilityConfig, PrivateCapability } from "./types.js";

export const gmailCapability: PrivateCapability = {
  id: "gmail",
  displayName: "Gmail",
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
      gmail_search: gmailSearchTool(auth),
      gmail_get_message: gmailGetMessageTool(auth),
    };

    logger.info({ tinoUserId: _tinoUserId }, "gmail tools enabled");
    return tools;
  },
};
