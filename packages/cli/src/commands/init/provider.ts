import { select } from '@inquirer/prompts';
import type { DeployConfig } from './types.js';
import { displayStep, displaySuccess } from '../../utils/display.js';

/**
 * Step 2: Cloud provider selection.
 * AWS is the only option — GCP/Render/Vercel are coming soon.
 */
export async function stepProvider(
  config: Partial<DeployConfig>
): Promise<Partial<DeployConfig>> {
  displayStep(2, 8, 'Cloud Provider');

  const provider = await select({
    message: 'Which cloud provider will you deploy to?',
    choices: [
      { name: 'AWS', value: 'aws' },
      { name: 'GCP (coming soon)', value: 'gcp', disabled: true },
      { name: 'Render (one-click — coming soon)', value: 'render', disabled: true },
      { name: 'Vercel (one-click — coming soon)', value: 'vercel', disabled: true },
    ],
    default: 'aws',
  });

  if (provider !== 'aws') {
    throw new Error('Only AWS is supported in this version.');
  }

  displaySuccess('AWS selected.');

  return {
    ...config,
    provider: 'aws',
  };
}
