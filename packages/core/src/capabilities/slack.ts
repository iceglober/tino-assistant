/**
 * Slack capability module — shared, centrally-configured.
 *
 * Wave 1: shared shell with no tools. Xoxp-scoped user tools have been
 * extracted to slack-personal.ts. Future waves will add bot-token (xoxb-)
 * public-channel search tools here.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */

import type { ToolSet } from "ai";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import type { CapabilityConfig, SharedCapability } from "./types.js";

export const slackCapability: SharedCapability = {
  id: "slack",
  displayName: "Slack",
  scope: "shared",

  fieldSchema: [],

  async registerTools(
    _config: CapabilityConfig,
    _configStore: ConfigStore,
    _logger: AppLogger,
    _tools: ToolSet,
  ): Promise<void> {
    // No tools registered in wave 1; xoxp-tools moved to slack-personal.ts.
    // Future: add bot-token public-channel search tools here.
  },
};
