import { select, input } from '@inquirer/prompts';
import type { DeployConfig } from './types.js';
import { displayStep, displaySuccess, displayInfo } from '../../utils/display.js';

const REGIONS = [
  {
    name: 'us-east-1 (recommended — broadest Bedrock model availability)',
    value: 'us-east-1',
  },
  { name: 'us-west-2', value: 'us-west-2' },
  { name: 'eu-west-1', value: 'eu-west-1' },
  { name: 'Custom region', value: '__custom__' },
];

/**
 * Step 5: Infrastructure configuration.
 * IaC choice, region, and VPC config.
 */
export async function stepInfrastructure(
  config: Partial<DeployConfig>
): Promise<Partial<DeployConfig>> {
  displayStep(5, 8, 'Infrastructure');

  // IaC choice
  const iacChoice = await select({
    message: 'Do you have an existing IaC project?',
    choices: [
      { name: 'No, create a new CDK project (recommended)', value: 'cdk' },
      {
        name: "Yes, I'll integrate tino's CDK stack into my existing project",
        value: 'existing',
      },
      { name: 'Yes, I use Terraform (generates Terraform config)', value: 'terraform' },
      { name: 'Yes, I use Pulumi (generates Pulumi config)', value: 'pulumi' },
    ],
    default: 'cdk',
  });

  const iac = iacChoice as DeployConfig['iac'];

  if (iac === 'cdk') {
    displaySuccess('CDK project will be created at ./infra/');
  } else if (iac === 'existing') {
    displayInfo("tino's CDK constructs will be exported for integration into your project.");
  } else if (iac === 'terraform') {
    displayInfo('Terraform config will be generated at ./infra/terraform/');
  } else if (iac === 'pulumi') {
    displayInfo('Pulumi config will be generated at ./infra/pulumi/');
  }

  // Region
  const regionChoice = await select({
    message: 'AWS region for deployment?',
    choices: REGIONS,
    default: 'us-east-1',
  });

  let region: string;
  if (regionChoice === '__custom__') {
    region = await input({
      message: 'Enter AWS region (e.g. ap-southeast-1):',
      validate: (v) => (v.trim().length > 0 ? true : 'Region cannot be empty'),
    });
    region = region.trim();
  } else {
    region = regionChoice;
  }

  displaySuccess(`Region: ${region}`);

  // VPC config
  const vpcChoice = await select({
    message: 'VPC configuration?',
    choices: [
      { name: 'Use default VPC (simplest)', value: 'default' },
      { name: 'Create a new VPC (more isolated)', value: 'new' },
      { name: 'Use existing VPC (enter VPC ID)', value: 'existing' },
    ],
    default: 'default',
  });

  let vpc: DeployConfig['vpc'];

  if (vpcChoice === 'existing') {
    const vpcId = await input({
      message: 'Enter VPC ID (vpc-...):',
      validate: (v) =>
        v.trim().startsWith('vpc-') ? true : 'VPC ID must start with vpc-',
    });
    vpc = { vpcId: vpcId.trim() };
    displaySuccess(`Using existing VPC: ${vpcId.trim()}`);
  } else {
    vpc = vpcChoice as 'default' | 'new';
    displaySuccess(`VPC: ${vpc}`);
  }

  return {
    ...config,
    iac,
    region,
    vpc,
  };
}
