/**
 * tino init — Bootstrap a new tino deployment.
 *
 * Guides the user through:
 * 1. Creating AWS SSM parameters for secrets
 * 2. Running CDK deploy for the infrastructure stack
 * 3. Building and pushing the Docker image
 */
export async function init(_args: string[]): Promise<void> {
  console.log('tino init: bootstrap flow not yet implemented');
  console.log('See scripts/setup-secrets.sh for manual setup instructions.');
}
