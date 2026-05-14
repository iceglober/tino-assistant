/**
 * tino deploy — Build the Docker image, push to ECR, and update the ECS service.
 *
 * Wraps scripts/deploy.sh with a friendlier interface.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '../../../../');

export async function deploy(_args: string[]): Promise<void> {
  const scriptPath = resolve(repoRoot, 'scripts/deploy.sh');
  console.log(`Running ${scriptPath}...`);
  execSync(`bash "${scriptPath}"`, { stdio: 'inherit' });
}
