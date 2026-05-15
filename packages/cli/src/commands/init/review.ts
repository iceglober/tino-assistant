import { select } from '@inquirer/prompts';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeployConfig } from './types.js';
import { displaySuccess, displayInfo, displaySummary } from '../../utils/display.js';

/**
 * Step 6: Review and deploy.
 * Shows summary box, writes tino.deploy.json, and optionally deploys.
 */
export async function stepReview(config: DeployConfig): Promise<void> {
  displaySummary(config);

  const choice = await select({
    message: 'Deploy now?',
    choices: [
      { name: 'Yes, deploy', value: 'deploy' },
      {
        name: 'No, save config and deploy later (writes tino.deploy.json)',
        value: 'save',
      },
    ],
    default: 'save',
  });

  // Write tino.deploy.json relative to where tino init was run
  const deployConfigPath = resolve(process.cwd(), 'tino.deploy.json');
  const safeConfig = buildSafeConfig(config);

  writeFileSync(deployConfigPath, JSON.stringify(safeConfig, null, 2) + '\n', 'utf8');
  displaySuccess(`Config written to ${deployConfigPath}`);
  displayInfo('  Credentials are NOT in this file — they are configured via the console after deploy.');

  if (choice === 'deploy') {
    const { executeDeploy } = await import('../deploy-executor.js');
    await executeDeploy(config);
  } else {
    displayInfo('');
    displayInfo('  Run `tino deploy` when you are ready to deploy.');
    displayInfo('');
    displaySuccess('tino init complete!');
    displayInfo('  Next steps:');
    displayInfo('  • Run `tino deploy` to deploy the infrastructure');
    displayInfo('  • Open the tino console to configure credentials and capabilities');
    displayInfo('  • Logs: aws logs tail /ecs/tino --follow');
  }
}

/**
 * Build a safe config object — no credential values, only boolean flags.
 */
function buildSafeConfig(config: DeployConfig): Record<string, unknown> {
  return {
    compliance: config.compliance,
    provider: config.provider,
    region: config.region,
    iac: config.iac,
    infraPath: config.infraPath,
    pulumiStack: config.pulumiStack,
    googleOAuthClientId: config.googleOAuthClientId,
    googleOAuthClientSecretSet: config.googleOAuthClientSecret.length > 0,
    allowedDomain: config.allowedDomain,
    hipaa: config.hipaa,
    generatedAt: new Date().toISOString(),
  };
}
