/**
 * Shared deployment logic used by both `tino deploy` and `tino init`.
 */
import { execaCommandSync } from 'execa';
import { resolve } from 'node:path';
import type { DeployConfig } from './init/types.js';
import { displaySuccess, displayError, displayInfo, displayStep } from '../utils/display.js';

function run(cmd: string, cwd?: string): void {
  execaCommandSync(cmd, { stdio: 'inherit', cwd });
}

function readPulumiOutputs(
  infraDir: string,
  stack: string
): { ecrRepoUri: string; clusterName: string; serviceName: string } {
  const get = (outputName: string) =>
    execaCommandSync(`pulumi stack output ${outputName} --stack ${stack}`, {
      cwd: infraDir,
    }).stdout.trim();

  return {
    ecrRepoUri: get('EcrRepoUri'),
    clusterName: get('ClusterName'),
    serviceName: get('ServiceName'),
  };
}

export async function executeDeploy(config: DeployConfig): Promise<void> {
  // All paths are relative to where `tino init` was run
  const cwd = process.cwd();
  const infraDir = config.iac === 'standalone'
    ? resolve(cwd, 'infra')
    : resolve(cwd, config.infraPath ?? 'infra');
  const stack = config.pulumiStack ?? 'dev';
  const region = config.region;

  // Verify the infra directory exists before trying to deploy
  try {
    const { statSync } = await import('node:fs');
    statSync(infraDir);
  } catch {
    displayError(`Infrastructure directory not found: ${infraDir}`);
    displayInfo(`  Run \`tino init\` first to generate the Pulumi project.`);
    process.exit(1);
  }

  try {
    // Step 0: Set Pulumi config values
    displayStep(1, 5, 'Configuring Pulumi stack');
    run(`pulumi config set aws:region ${region} --stack ${stack}`, infraDir);
    if (config.googleOAuthClientId) {
      run(`pulumi config set tino:googleOAuthClientId ${config.googleOAuthClientId} --stack ${stack}`, infraDir);
    }
    if (config.googleOAuthClientSecret) {
      run(`pulumi config set --secret tino:googleOAuthClientSecret ${config.googleOAuthClientSecret} --stack ${stack}`, infraDir);
    }
    if (config.allowedDomain) {
      run(`pulumi config set tino:allowedDomain ${config.allowedDomain} --stack ${stack}`, infraDir);
    }
    // BAA acknowledgment (required when HIPAA compliance is on)
    run(`pulumi config set tino:baaAcknowledged true --stack ${stack}`, infraDir);

    // Step 1: pulumi up
    displayStep(2, 5, 'Deploying infrastructure (pulumi up)');
    run(`pulumi up --yes --stack ${stack}`, infraDir);

    // Step 2: Read Pulumi stack outputs
    displayStep(2, 5, 'Reading stack outputs');
    const outputs = readPulumiOutputs(infraDir, stack);

    // Step 3: Docker build
    displayStep(3, 5, 'Building Docker image');
    run('docker build -t tino:latest .', cwd);

    // Step 4: ECR login + push
    displayStep(4, 5, 'Pushing to ECR');
    const ecrRepo = outputs.ecrRepoUri;
    run(`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecrRepo}`);
    run(`docker tag tino:latest ${ecrRepo}:latest`);
    run(`docker push ${ecrRepo}:latest`, cwd);

    // Step 5: ECS force new deployment
    displayStep(5, 5, 'Deploying to ECS');
    run(`aws ecs update-service --cluster ${outputs.clusterName} --service ${outputs.serviceName} --force-new-deployment --region ${region} --no-cli-pager`);

    displaySuccess('tino is deployed!');
    displayInfo(`  Open the console URL from: pulumi stack output consoleUrl --stack ${stack} --cwd ${infraDir}`);
    displayInfo(`  Logs: aws logs tail /ecs/tino --follow --region ${region}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    displayError(`Deployment failed: ${message}`);
    process.exit(1);
  }
}
