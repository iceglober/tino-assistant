import { select } from '@inquirer/prompts';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeployConfig } from './types.js';
import { displaySuccess, displayInfo, displaySummary } from '../../utils/display.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Repo root is 5 levels up from packages/cli/src/commands/init/
const repoRoot = resolve(__dirname, '../../../../../');

/**
 * Step 8: Review and deploy.
 * Shows summary box, writes tino.deploy.json, and prints dry-run deploy plan.
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

  // Write tino.deploy.json — credentials are NEVER included
  const deployConfigPath = resolve(repoRoot, 'tino.deploy.json');
  const safeConfig = buildSafeConfig(config);

  writeFileSync(deployConfigPath, JSON.stringify(safeConfig, null, 2) + '\n', 'utf8');
  displaySuccess(`Config written to ${deployConfigPath}`);
  displayInfo('  Credentials are NOT in this file — they are in Secrets Manager.');

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
    displayInfo('  • DM tino in Slack once deployed');
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
    model: config.model,
    iac: config.iac,
    vpc: config.vpc,
    slack: {
      botTokenSet: config.slack.botTokenSet,
      appTokenSet: config.slack.appTokenSet,
      adminUserId: config.slack.adminUserId,
    },
    capabilities: Object.fromEntries(
      Object.entries(config.capabilities).map(([k, v]) => [
        k,
        { enabled: v.enabled, baaStatus: v.baaStatus },
      ])
    ),
    hipaa: config.hipaa,
    generatedAt: new Date().toISOString(),
  };
}

