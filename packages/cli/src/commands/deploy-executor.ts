/**
 * Shared deployment logic used by both `tino deploy` and `tino init` step 7.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { DeployConfig } from './init/types.js';
import { displaySuccess, displayError, displayInfo, displayStep } from '../utils/display.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function run(cmd: string, cwd?: string): void {
  execSync(cmd, { stdio: 'inherit', cwd, env: { ...process.env } });
}

function readPulumiOutputs(
  infraDir: string,
  stack: string
): { ecrRepoUri: string; clusterName: string; serviceName: string } {
  const get = (outputName: string) =>
    execSync(`pulumi stack output ${outputName} --stack ${stack}`, {
      cwd: infraDir,
      encoding: 'utf8',
    }).trim();

  return {
    ecrRepoUri: get('EcrRepoUri'),
    clusterName: get('ClusterName'),
    serviceName: get('ServiceName'),
  };
}

export async function executeDeploy(config: DeployConfig): Promise<void> {
  // Repo root is 5 levels up from packages/cli/src/commands/
  const repoRoot = resolve(__dirname, '../../../../../');
  const infraDir =
    config.iac === 'standalone'
      ? resolve(repoRoot, 'infra')
      : resolve(repoRoot, config.infraPath ?? 'infra');
  const stack = config.pulumiStack ?? 'dev';
  const region = config.region;

  try {
    // Step 1: pulumi up
    displayStep(1, 5, 'Deploying infrastructure (pulumi up)');
    run(`pulumi up --yes --stack ${stack}`, infraDir);

    // Step 2: Read Pulumi stack outputs
    displayStep(2, 5, 'Reading stack outputs');
    const outputs = readPulumiOutputs(infraDir, stack);

    // Step 3: Docker build
    displayStep(3, 5, 'Building Docker image');
    run('docker build -t tino:latest .', repoRoot);

    // Step 4: ECR login + push
    displayStep(4, 5, 'Pushing to ECR');
    const ecrRepo = outputs.ecrRepoUri;
    run(`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecrRepo}`);
    run(`docker tag tino:latest ${ecrRepo}:latest`);
    run(`docker push ${ecrRepo}:latest`, repoRoot);

    // Step 5: ECS force new deployment
    displayStep(5, 5, 'Deploying to ECS');
    run(`aws ecs update-service --cluster ${outputs.clusterName} --service ${outputs.serviceName} --force-new-deployment --region ${region} --no-cli-pager`);

    displaySuccess('tino is deployed!');
    displayInfo(`  DM tino in Slack to get started.`);
    displayInfo(`  Logs: aws logs tail /ecs/tino --follow --region ${region}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    displayError(`Deployment failed: ${message}`);
    process.exit(1);
  }
}
