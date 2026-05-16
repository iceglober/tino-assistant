import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { generateText, type LanguageModel } from 'ai';

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

export type BedrockValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Verify that a Bedrock model ID is reachable with the current AWS credentials.
 *
 * Strategy: send a minimal `generateText` call (1-token output) through the
 * already-installed `@ai-sdk/amazon-bedrock` wrapper. We deliberately avoid
 * adding a separate `@aws-sdk/client-bedrock` control-plane dependency just
 * for a `ListInferenceProfiles` call.
 *
 * Cost: at most one cheap input/output token per startup — bounded by
 * `maxOutputTokens: 1`. This trades the absolute-minimum cost (a control-plane
 * lookup) for not adding a dependency.
 *
 * Returns a discriminated union; never throws. On failure, the caller can fall
 * back to `DEFAULT_BEDROCK_MODEL_ID`.
 */
export async function validateBedrockModel(
  modelId: string,
  region?: string,
): Promise<BedrockValidationResult> {
  try {
    const model = createBedrockModel(modelId, region);
    await generateText({
      model,
      prompt: 'ok',
      maxOutputTokens: 1,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
