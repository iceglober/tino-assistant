import { select, input } from '@inquirer/prompts';
import type { DeployConfig } from './types.js';
import { displayStep, displaySuccess, displayInfo, displayWarning } from '../../utils/display.js';
import { listBedrockModels, verifyBedrockModel } from '../../utils/aws.js';

const DEFAULT_MODEL = 'global.anthropic.claude-sonnet-4-6';

const PRESET_MODELS = [
  {
    name: 'Claude Sonnet 4.6 (global.anthropic.claude-sonnet-4-6) — recommended',
    value: DEFAULT_MODEL,
  },
  {
    name: 'Claude Sonnet 4.5 (us.anthropic.claude-sonnet-4-5-20250929-v1:0)',
    value: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  },
  {
    name: 'Custom model ID (enter manually)',
    value: '__custom__',
  },
];

/**
 * Step 4: AI provider and model selection.
 * Bedrock is the only option. Lists available inference profiles and verifies access.
 */
export async function stepModel(config: Partial<DeployConfig>): Promise<Partial<DeployConfig>> {
  displayStep(4, 8, 'AI Provider & Model');

  // AI provider — Bedrock only
  await select({
    message: 'Which AI provider will you use?',
    choices: [
      {
        name: 'Amazon Bedrock (Claude — BAA available via AWS Artifact)',
        value: 'bedrock',
      },
      { name: '(more coming soon)', value: 'bedrock', disabled: true },
    ],
    default: 'bedrock',
  });

  displaySuccess('Amazon Bedrock selected.');
  displayInfo('HIPAA note: the AWS BAA covers the Bedrock SERVICE (data handling,');
  displayInfo('  encryption, access controls). As of 2025, Amazon Bedrock is listed');
  displayInfo('  as a HIPAA-eligible AWS service.');
  displayInfo('');
  displayInfo('  ✓ Bedrock is HIPAA-eligible. Proceeding.');

  // Model selection
  const region = config.region ?? 'us-east-1';

  displayInfo(`Fetching available Bedrock inference profiles in ${region}...`);
  const availableModels = await listBedrockModels(region);

  if (availableModels.length > 0) {
    displayInfo(`Found ${availableModels.length} inference profile(s) on your account.`);
  }

  const modelChoice = await select({
    message: 'Which model?',
    choices: PRESET_MODELS,
    default: DEFAULT_MODEL,
  });

  let modelId: string;

  if (modelChoice === '__custom__') {
    modelId = await input({
      message: 'Enter the Bedrock model ID or inference profile ID:',
      validate: (v) => (v.trim().length > 0 ? true : 'Model ID cannot be empty'),
    });
    modelId = modelId.trim();
  } else {
    modelId = modelChoice;
  }

  // Verify access
  displayInfo(`Checking Bedrock model access for ${modelId}...`);
  const accessible = await verifyBedrockModel(modelId, region);

  if (accessible) {
    displaySuccess(`${modelId} is ACTIVE on your account.`);
  } else {
    displayWarning(`Could not verify access to ${modelId}.`);
    displayInfo('  You may need to request model access in the Bedrock console.');
    displayInfo('  https://console.aws.amazon.com/bedrock/home#/modelaccess');
    displayInfo('  Proceeding — you can update the model ID in tino.deploy.json later.');
  }

  return {
    ...config,
    model: {
      provider: 'bedrock',
      modelId,
    },
  };
}
