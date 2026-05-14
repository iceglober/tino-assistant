/**
 * tino deploy — Build the Docker image, push to ECR, and update the ECS service.
 */
import { command } from 'cmd-ts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeployConfig } from './init/types.js';
import { displayError } from '../utils/display.js';
import { executeDeploy } from './deploy-executor.js';

export const deploy = command({
  name: 'deploy',
  description: 'Deploy tino to AWS (ECS Fargate)',
  args: {},
  handler: async () => {
    // Read tino.deploy.json from the repo root (cwd when the user runs `tino deploy`)
    const configPath = resolve(process.cwd(), 'tino.deploy.json');
    if (!existsSync(configPath)) {
      displayError('tino.deploy.json not found. Run `tino init` first.');
      process.exit(1);
    }

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as DeployConfig;
    await executeDeploy(config);
  },
});
