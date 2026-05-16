import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { Env } from "../../env.js";

/**
 * Single shared CloudWatch Logs client.
 *
 * Auth: default credential chain — picks up SSO from ~/.aws/config,
 * container-role creds, or static keys.
 *
 * Region: optional `env.AWS_REGION`; if absent, the SDK chain resolves it
 * from AWS_REGION/AWS_DEFAULT_REGION env vars or SSO config.
 */
export function createCloudWatchLogsClient(env: Env): CloudWatchLogsClient {
  return new CloudWatchLogsClient({
    region: env.AWS_REGION,
    credentials: fromNodeProviderChain(),
  });
}
