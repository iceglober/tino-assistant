/**
 * Shared deployment logic used by both `tino deploy` and `tino init` step 8.
 */
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { DeployConfig } from './init/types.js';
import { displaySuccess, displayError, displayInfo, displayStep } from '../utils/display.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function runCommand(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with exit code ${code}`));
    });
  });
}

function readStackOutputs(region: string): {
  ecrRepoUri: string;
  clusterName: string;
  serviceName: string;
} {
  const raw = execSync(
    `aws cloudformation describe-stacks --stack-name TinoStack --region ${region} --output json`,
    { encoding: 'utf8' }
  );
  const stacks = JSON.parse(raw) as {
    Stacks: Array<{ Outputs: Array<{ OutputKey: string; OutputValue: string }> }>;
  };
  const outputs = stacks.Stacks[0]?.Outputs ?? [];
  const get = (key: string) => outputs.find((o) => o.OutputKey === key)?.OutputValue ?? '';
  return {
    ecrRepoUri: get('EcrRepoUri'),
    clusterName: get('ClusterName'),
    serviceName: get('ServiceName'),
  };
}

export async function executeDeploy(config: DeployConfig): Promise<void> {
  // Repo root is 5 levels up from packages/cli/src/commands/
  const repoRoot = resolve(__dirname, '../../../../../');
  const infraDir = resolve(repoRoot, 'packages/aws/src/infra');
  const region = config.region;

  try {
    // Step 1: CDK bootstrap
    displayStep(1, 6, 'CDK bootstrap');
    await runCommand('npx', ['cdk', 'bootstrap'], infraDir);

    // Step 2: CDK deploy
    displayStep(2, 6, 'CDK deploy');
    await runCommand('npx', ['cdk', 'deploy', '--require-approval', 'never'], infraDir);

    // Step 3: Read stack outputs
    displayStep(3, 6, 'Reading stack outputs');
    const outputs = readStackOutputs(region);

    // Step 4: Docker build
    displayStep(4, 6, 'Building Docker image');
    await runCommand('docker', ['build', '-t', 'tino:latest', '.'], repoRoot);

    // Step 5: ECR login + push
    displayStep(5, 6, 'Pushing to ECR');
    const ecrRepo = outputs.ecrRepoUri;
    execSync(
      `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecrRepo}`,
      { stdio: 'inherit' }
    );
    execSync(`docker tag tino:latest ${ecrRepo}:latest`, { stdio: 'inherit' });
    await runCommand('docker', ['push', `${ecrRepo}:latest`], repoRoot);

    // Step 6: ECS force new deployment
    displayStep(6, 6, 'Deploying to ECS');
    execSync(
      `aws ecs update-service --cluster ${outputs.clusterName} --service ${outputs.serviceName} --force-new-deployment --region ${region} --no-cli-pager`,
      { stdio: 'inherit' }
    );

    displaySuccess('tino is deployed!');
    displayInfo(`  DM tino in Slack to get started.`);
    displayInfo(`  Logs: aws logs tail /ecs/tino --follow --region ${region}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    displayError(`Deployment failed: ${message}`);
    process.exit(1);
  }
}
