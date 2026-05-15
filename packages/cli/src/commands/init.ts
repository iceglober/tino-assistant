/**
 * tino init — Bootstrap a new HIPAA-compliant tino deployment.
 *
 * Chains 7 interactive steps to collect a full DeployConfig,
 * then writes tino.deploy.json and prints a dry-run deploy plan.
 */
import { command } from 'cmd-ts';
import { displayBanner } from '../utils/display.js';
import { stepCompliance } from './init/compliance.js';
import { stepProvider } from './init/provider.js';
import { stepBaa } from './init/baa.js';
import { stepModel } from './init/model.js';
import { stepInfrastructure } from './init/infrastructure.js';
import { stepConsoleAuth } from './init/console-auth.js';
import { stepReview } from './init/review.js';
import type { DeployConfig } from './init/types.js';

export const init = command({
  name: 'init',
  description: 'Set up a new HIPAA-compliant tino deployment',
  args: {},
  handler: async () => {
    displayBanner();

    let config: Partial<DeployConfig> = {};

    config = await stepCompliance(config);
    config = await stepProvider(config);
    config = await stepBaa(config);
    config = await stepModel(config);
    config = await stepInfrastructure(config);
    config = await stepConsoleAuth(config);
    await stepReview(config as DeployConfig);
  },
});
