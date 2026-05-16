/**
 * Gmail capability module.
 *
 * Registers gmail_search, gmail_get_message tools.
 * Uses Google OAuth credentials from the capability config.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */
import type { ToolSet } from "ai";
import { google } from "googleapis";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import { gmailGetMessageTool, gmailSearchTool } from "../tools/google/gmail.js";
import type { CapabilityConfig, CapabilityModule } from "./types.js";

export const gmailCapability: CapabilityModule = {
  id: "gmail",
  displayName: "Gmail",

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

  async registerTools(
    config: CapabilityConfig,
    _configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void> {
    const { clientId, clientSecret, refreshToken } = config.credentials;
    if (!clientId) throw new Error("Gmail capability: credentials.clientId is not set");
    if (!clientSecret) throw new Error("Gmail capability: credentials.clientSecret is not set");
    if (!refreshToken) throw new Error("Gmail capability: credentials.refreshToken is not set");

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    tools.gmail_search = gmailSearchTool(auth);
    tools.gmail_get_message = gmailGetMessageTool(auth);

    logger.info("gmail tools enabled");
  },
};
