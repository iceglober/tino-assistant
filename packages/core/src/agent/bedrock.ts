import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { LanguageModel } from 'ai';

/** Default model used when no model ID is configured. */
export const DEFAULT_BEDROCK_MODEL_ID = 'global.anthropic.claude-sonnet-4-6';

/**
 * Build a configured Bedrock model handle for use with `generateText`.
 *
 * The model ID is read from the config store at startup (key: `bedrock.modelId`).
 * Falls back to DEFAULT_BEDROCK_MODEL_ID if not configured.
 *
 * AWS_REGION is optional — the SDK resolves it from the default credential
 * chain (AWS_REGION env var, ~/.aws/config, IMDS, etc.).
 */
export function createBedrockModel(modelId: string, region?: string): LanguageModel {
  const bedrock = createAmazonBedrock({
    region, // optional; SDK falls back to AWS_REGION/AWS_DEFAULT_REGION/SSO config
    credentialProvider: fromNodeProviderChain(),
  });

  return bedrock(modelId);
}
