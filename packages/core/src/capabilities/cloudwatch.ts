/**
 * CloudWatch capability module.
 *
 * Registers cloudwatch_logs_query tool.
 * Uses AWS default credential chain — no explicit credentials needed.
 * Settings: logGroups (allowlist), region.
 *
 * findWork: stub (not yet implemented — enabled=false by default).
 */

import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { ToolSet } from "ai";
import type { ConfigStore } from "../persistence/config.js";
import type { AppLogger } from "../slack/app.js";
import { cloudwatchLogsQueryTool } from "../tools/cloudwatch/query.js";
import type { CapabilityConfig, CapabilityModule } from "./types.js";

export const cloudwatchCapability: CapabilityModule = {
  id: "cloudwatch",
  displayName: "CloudWatch",

  fieldSchema: [
    {
      key: "logGroups",
      label: "Log Group Allowlist",
      target: "settings.logGroups",
      kind: "string[]",
      placeholder: "/aws/lambda/foo, /aws/ecs/bar (comma or newline separated)",
    },
    {
      key: "region",
      label: "AWS Region",
      target: "settings.region",
      placeholder: "us-east-1 (defaults to AWS_REGION env)",
    },
  ],

  async registerTools(
    config: CapabilityConfig,
    _configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,
  ): Promise<void> {
    const region = (config.settings.region as string | undefined) || undefined;
    const allowedLogGroups = (config.settings.logGroups as string[] | undefined) ?? [];
    const awsProfile = (config.settings.awsProfile as string | undefined) || undefined;

    const client = new CloudWatchLogsClient({
      region,
      credentials: fromNodeProviderChain({ profile: awsProfile }),
    });

    tools.cloudwatch_logs_query = cloudwatchLogsQueryTool({ client, logger, allowedLogGroups });

    logger.info({ allowlistSize: allowedLogGroups.length }, "cloudwatch tools enabled");
  },
};
