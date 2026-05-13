import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// SSM parameter names for all tino secrets.
// The user must create these manually before deploying:
//   aws ssm put-parameter --name /tino/SLACK_BOT_TOKEN --value "xoxb-..." --type SecureString
const SSM_PARAMS: Record<string, string> = {
  SLACK_BOT_TOKEN: '/tino/SLACK_BOT_TOKEN',
  SLACK_APP_TOKEN: '/tino/SLACK_APP_TOKEN',
  SLACK_USER_TOKEN: '/tino/SLACK_USER_TOKEN',
  ALLOWED_SLACK_USER_ID: '/tino/ALLOWED_SLACK_USER_ID',
  GITHUB_TOKEN: '/tino/GITHUB_TOKEN',
  GITHUB_DEFAULT_REPO: '/tino/GITHUB_DEFAULT_REPO',
  GOOGLE_OAUTH_CLIENT_ID: '/tino/GOOGLE_OAUTH_CLIENT_ID',
  GOOGLE_OAUTH_CLIENT_SECRET: '/tino/GOOGLE_OAUTH_CLIENT_SECRET',
  GOOGLE_OAUTH_REFRESH_TOKEN: '/tino/GOOGLE_OAUTH_REFRESH_TOKEN',
  BEDROCK_MODEL_ID: '/tino/BEDROCK_MODEL_ID',
};

export class TinoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── VPC ──────────────────────────────────────────────────────────────────
    // Use the account's default VPC. If no default VPC exists, cdk deploy will
    // fail with a clear error. Create one with: aws ec2 create-default-vpc
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // ── ECR Repository ───────────────────────────────────────────────────────
    const ecrRepo = new ecr.Repository(this, 'TinoRepo', {
      repositoryName: 'tino',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── EFS File System ──────────────────────────────────────────────────────
    // Stores tino.db across task restarts and deploys.
    const fileSystem = new efs.FileSystem(this, 'TinoEfs', {
      vpc,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encrypted: true,
    });

    const accessPoint = new efs.AccessPoint(this, 'TinoEfsAccessPoint', {
      fileSystem,
      path: '/data',
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '755',
      },
      posixUser: {
        gid: '1000',
        uid: '1000',
      },
    });

    // ── CloudWatch Log Group ─────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'TinoLogGroup', {
      logGroupName: '/ecs/tino',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── ECS Cluster ──────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'TinoCluster', { vpc });

    // ── Task Role ────────────────────────────────────────────────────────────
    const taskRole = new iam.Role(this, 'TinoTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Bedrock: invoke any model in the account (MVP — scope down later)
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
      }),
    );

    // CloudWatch Logs: query access for the CloudWatch tool
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:StartQuery',
          'logs:GetQueryResults',
          'logs:StopQuery',
          'logs:DescribeLogGroups',
          'logs:FilterLogEvents',
        ],
        resources: ['*'],
      }),
    );

    // ── Execution Role ───────────────────────────────────────────────────────
    const executionRole = new iam.Role(this, 'TinoExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    // SSM: read all /tino/* parameters at task startup
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameters', 'ssm:GetParameter'],
        resources: Object.values(SSM_PARAMS).map(
          (name) =>
            `arn:aws:ssm:${this.region}:${this.account}:parameter${name}`,
        ),
      }),
    );

    // KMS: decrypt SecureString parameters (uses the default SSM key)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
        conditions: {
          StringEquals: {
            'kms:ViaService': `ssm.${this.region}.amazonaws.com`,
          },
        },
      }),
    );

    // ── Task Definition ──────────────────────────────────────────────────────
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TinoTaskDef', {
      cpu: 256,    // 0.25 vCPU
      memoryLimitMiB: 512,
      taskRole,
      executionRole,
      volumes: [
        {
          name: 'tino-data',
          efsVolumeConfiguration: {
            fileSystemId: fileSystem.fileSystemId,
            transitEncryption: 'ENABLED',
            authorizationConfig: {
              accessPointId: accessPoint.accessPointId,
              iam: 'ENABLED',
            },
          },
        },
      ],
    });

    // Grant the task role EFS access
    fileSystem.grantRootAccess(taskRole);

    // Build the secrets map from SSM parameter names
    const containerSecrets: Record<string, ecs.Secret> = {};
    for (const [envVar, paramName] of Object.entries(SSM_PARAMS)) {
      containerSecrets[envVar] = ecs.Secret.fromSsmParameter(
        ssm.StringParameter.fromSecureStringParameterAttributes(
          this,
          `Param${envVar}`,
          { parameterName: paramName },
        ),
      );
    }

    const container = taskDefinition.addContainer('tino', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
      environment: {
        NODE_ENV: 'production',
        DB_PATH: '/data/tino.db',
        LOG_LEVEL: 'info',
      },
      secrets: containerSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'tino',
        logGroup,
      }),
      essential: true,
    });

    container.addMountPoints({
      containerPath: '/data',
      sourceVolume: 'tino-data',
      readOnly: false,
    });

    // ── ECS Service ──────────────────────────────────────────────────────────
    // assignPublicIp: true — Fargate in public subnet gets a public IP for
    // outbound internet (Slack WebSocket, GitHub API, Bedrock). No NAT gateway
    // needed, saving ~$30/month.
    const service = new ecs.FargateService(this, 'TinoService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      // Allow EFS traffic from the service security group
      securityGroups: [],
    });

    // Allow the service to reach EFS
    fileSystem.connections.allowDefaultPortFrom(service.connections);

    // ── CloudFormation Outputs ───────────────────────────────────────────────
    // Used by scripts/deploy.sh to find the cluster/service/repo without
    // hardcoding CDK-generated names.
    new cdk.CfnOutput(this, 'EcrRepoUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR repository URI for the tino container image',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: service.serviceName,
      description: 'ECS service name',
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch log group for tino container logs',
    });
  }
}
