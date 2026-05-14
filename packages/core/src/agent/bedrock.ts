import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { LanguageModel } from 'ai';
import type { Env } from '../env.js';

/**
 * Build a configured Bedrock model handle for use with `generateText`.
 *
 * Throws if BEDROCK_MODEL_ID is unset — Phase 3+ requires it. We could fall
 * back to a default but explicit failure is friendlier than a confusing
 * ValidationException from Bedrock about an empty model ID.
 */
export function createBedrockModel(env: Env): LanguageModel {
  if (!env.BEDROCK_MODEL_ID) {
    throw new Error(
      'BEDROCK_MODEL_ID is not set. See .env.example — recommended: global.anthropic.claude-sonnet-4-6',
    );
  }

  const bedrock = createAmazonBedrock({
    region: env.AWS_REGION, // optional; SDK falls back to AWS_REGION/AWS_DEFAULT_REGION/SSO config
    credentialProvider: fromNodeProviderChain({ profile: env.AWS_PROFILE }),
  });

  return bedrock(env.BEDROCK_MODEL_ID);
}
