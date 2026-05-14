import { select } from '@inquirer/prompts';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeployConfig } from './types.js';
import { displaySuccess, displayInfo, displayWarning, displaySummary } from '../../utils/display.js';

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
    printDryRunPlan(config);
    displayInfo('');
    displayInfo('  Run `tino deploy` to execute these steps.');
    displayInfo('  (Full deploy implementation coming in Dispatch B)');
  } else {
    displayInfo('');
    displayInfo('  Run `tino deploy` when you are ready to deploy.');
  }

  displayInfo('');
  displaySuccess('tino init complete!');
  displayInfo('  Next steps:');
  displayInfo('  • Run `tino deploy` to deploy the infrastructure');
  displayInfo('  • DM tino in Slack once deployed');
  displayInfo('  • Logs: aws logs tail /ecs/tino --follow');
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

/**
 * Print what the deploy step WOULD do (dry-run).
 */
function printDryRunPlan(config: DeployConfig): void {
  const enabledCaps = Object.entries(config.capabilities)
    .filter(([, v]) => v.enabled)
    .map(([k]) => k);

  const secretNames = [
    '/tino/SLACK_BOT_TOKEN',
    '/tino/SLACK_APP_TOKEN',
    '/tino/BEDROCK_MODEL_ID',
    ...enabledCaps.flatMap((cap) => {
      switch (cap) {
        case 'github':
          return ['/tino/GITHUB_PAT'];
        case 'linear':
          return ['/tino/LINEAR_TOKEN'];
        case 'google-calendar':
        case 'gmail':
          return ['/tino/GOOGLE_CLIENT_ID', '/tino/GOOGLE_CLIENT_SECRET'];
        case 'slack-reading':
          return ['/tino/SLACK_USER_TOKEN'];
        default:
          return [];
      }
    }),
  ];

  // Deduplicate
  const uniqueSecrets = [...new Set(secretNames)];

  displayInfo('');
  displayInfo('  Dry-run deploy plan:');
  displayInfo(`  [dry-run] would run: cd packages/aws && npx cdk deploy`);
  displayInfo(
    `  [dry-run] would push ${uniqueSecrets.length} secrets to Secrets Manager (${uniqueSecrets.join(', ')})`
  );
  displayInfo(`  [dry-run] would run: docker build -t tino:latest .`);
  displayInfo(`  [dry-run] would run: docker push <ecr-repo>/tino:latest`);
  displayInfo(
    `  [dry-run] would run: aws ecs update-service --cluster tino --service tino --force-new-deployment --region ${config.region}`
  );

  if (config.iac === 'terraform') {
    displayWarning('  Terraform IaC selected — CDK deploy step will be replaced with terraform apply.');
  } else if (config.iac === 'pulumi') {
    displayWarning('  Pulumi IaC selected — CDK deploy step will be replaced with pulumi up.');
  }
}
