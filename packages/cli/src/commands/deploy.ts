/**
 * tino deploy — Build the Docker image, push to ECR, and update the ECS service.
 *
 * Placeholder command — full implementation in Dispatch B.
 */
import { command } from 'cmd-ts';

export const deploy = command({
  name: 'deploy',
  description: 'Build, push, and deploy tino to ECS (coming in Dispatch B)',
  args: {},
  handler: async () => {
    console.log('tino deploy: not yet implemented.');
    console.log('Run `tino init` first to generate tino.deploy.json, then re-run `tino deploy`.');
  },
});
