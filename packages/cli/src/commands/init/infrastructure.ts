import { select, input } from '@inquirer/prompts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execaCommandSync } from 'execa';
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

const STANDALONE_PACKAGE_JSON = `{
  "name": "tino-infra",
  "private": true,
  "type": "module",
  "dependencies": {
    "@pulumi/aws": "^7.0.0",
    "@pulumi/awsx": "^3.0.0",
    "@pulumi/pulumi": "^3.0.0",
    "@tino/aws": "*",
    "@tino/core": "*"
  }
}
`;

const STANDALONE_PULUMI_YAML = `name: tino-infra
runtime:
  name: nodejs
  options:
    typescript: true
main: index.ts
`;

const STANDALONE_INDEX_TS = `import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { TinoService } from "@tino/aws/pulumi";

const config = new pulumi.Config("tino");

const defaultVpc = aws.ec2.getVpcOutput({ default: true });
const subnets = aws.ec2.getSubnetsOutput({
  filters: [{ name: "vpc-id", values: [defaultVpc.id] }],
});

const tino = new TinoService("tino", {
  vpc: defaultVpc.id,
  subnets: subnets.ids,
  googleOAuthClientId: config.require("googleOAuthClientId"),
  googleOAuthClientSecret: config.requireSecret("googleOAuthClientSecret"),
  allowedDomain: config.get("allowedDomain"),
});

export const consoleUrl = tino.consoleUrl;
export const ecrRepoUri = tino.ecrRepoUri;
export const clusterName = tino.clusterName;
export const serviceName = tino.serviceName;
export const tableName = tino.tableName;
`;

function generateExistingTinoTs(): string {
  return `import * as pulumi from "@pulumi/pulumi";
import { TinoService } from "@tino/aws/pulumi";

/**
 * Deploy tino into your existing infrastructure.
 *
 * Call this from your main index.ts:
 *   import { createTino } from "./tino.js";
 *   const tino = createTino({ vpc: network.vpcId, subnets: network.privateSubnetIds, cluster: existingCluster });
 */
export function createTino(opts: {
  vpc: pulumi.Input<string>;
  subnets: pulumi.Input<string>[];
  cluster?: import("@pulumi/aws").ecs.Cluster;
}) {
  const config = new pulumi.Config("tino");

  return new TinoService("tino", {
    vpc: opts.vpc,
    subnets: opts.subnets,
    cluster: opts.cluster,
    googleOAuthClientId: config.require("googleOAuthClientId"),
    googleOAuthClientSecret: config.requireSecret("googleOAuthClientSecret"),
    allowedDomain: config.get("allowedDomain"),
  });
}
`;
}

/**
 * Step 5: Infrastructure configuration.
 * Pulumi is the only IaC path — standalone project or existing project.
 */
export async function stepInfrastructure(
  config: Partial<DeployConfig>
): Promise<Partial<DeployConfig>> {
  displayStep(4, 6, 'Infrastructure');

  const iacChoice = await select({
    message: 'Infrastructure setup:',
    choices: [
      {
        name: 'Create a new Pulumi project (standalone deployment)',
        value: 'standalone',
      },
      {
        name: 'Add tino to an existing Pulumi project',
        value: 'existing',
      },
    ],
    default: 'standalone',
  });

  const iac = iacChoice as DeployConfig['iac'];

  let infraPath: string | undefined;
  let pulumiStack: string | undefined;

  if (iac === 'standalone') {
    const rawInfraPath = await input({
      message: 'Directory for the tino Pulumi project:',
      default: './infra-tino',
    });
    infraPath = rawInfraPath.trim();

    const infraDir = resolve(process.cwd(), infraPath);
    displaySuccess(`Pulumi project will be created at ${infraPath}/`);
    displayInfo('');
    mkdirSync(infraDir, { recursive: true });
    writeFileSync(resolve(infraDir, 'package.json'), STANDALONE_PACKAGE_JSON);
    writeFileSync(resolve(infraDir, 'Pulumi.yaml'), STANDALONE_PULUMI_YAML);
    writeFileSync(resolve(infraDir, 'index.ts'), STANDALONE_INDEX_TS);
    displaySuccess('Generated infra/package.json, infra/Pulumi.yaml, infra/index.ts');

    // Install dependencies
    displayInfo('  Installing dependencies...');
    try {
      execaCommandSync('pnpm install', { cwd: infraDir, stdio: 'inherit' });
      displaySuccess('Dependencies installed.');
    } catch {
      displayInfo('  pnpm install failed — trying npm install...');
      try {
        execaCommandSync('npm install', { cwd: infraDir, stdio: 'inherit' });
        displaySuccess('Dependencies installed.');
      } catch {
        displayInfo('  ⚠ Could not install dependencies. Run `pnpm install` in infra/ manually.');
      }
    }

    // Link @tino/aws if it's available globally (from pnpm link --global)
    try {
      execaCommandSync('pnpm link --global @tino/aws @tino/core', { cwd: infraDir, stdio: 'pipe' });
      displaySuccess('Linked @tino/aws and @tino/core from global.');
    } catch {
      // Not linked globally — that's fine if they're published to npm
    }

    // Ask for stack name
    const rawStack = await input({
      message: 'Pulumi stack name:',
      default: 'dev',
    });
    pulumiStack = rawStack.trim();

    // Init the Pulumi stack
    try {
      execaCommandSync(`pulumi stack init ${pulumiStack}`, { cwd: infraDir, stdio: 'pipe' });
      displaySuccess(`Pulumi stack '${pulumiStack}' created.`);
    } catch {
      // Stack might already exist — that's fine
      displayInfo(`  Stack '${pulumiStack}' may already exist — continuing.`);
    }
  } else {
    const rawPath = await input({
      message: 'Path to your Pulumi project:',
      default: './infra',
    });
    infraPath = rawPath.trim();

    const rawStack = await input({
      message: 'Pulumi stack name:',
      default: 'dev',
    });
    pulumiStack = rawStack.trim();

    // Generate tino.ts in the existing project
    const tinoTsPath = resolve(process.cwd(), infraPath, 'tino.ts');
    writeFileSync(tinoTsPath, generateExistingTinoTs());
    displaySuccess(`Generated ${infraPath}/tino.ts`);
    displayInfo('');
    displayInfo('Add this to your Pulumi index.ts:');
    displayInfo('  import { createTino } from "./tino.js";');
    displayInfo('  const tino = createTino(network);');
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

  return {
    ...config,
    iac,
    ...(infraPath !== undefined ? { infraPath } : {}),
    ...(pulumiStack !== undefined ? { pulumiStack } : {}),
    region,
  };
}
