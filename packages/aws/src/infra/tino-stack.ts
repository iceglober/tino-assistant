import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
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

    // ── DynamoDB Table ───────────────────────────────────────────────────────
    // Single-table design. RETAIN on delete to protect production data.
    // PAY_PER_REQUEST billing — tino is low-traffic, no need to provision.
    const table = new dynamodb.Table(this, 'TinoTable', {
      tableName: 'tino',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1: partition by task status, sort by scheduledAt (zero-padded string)
    // Enables listPending: gsi1pk=TASK_STATUS#pending AND gsi1sk <= <now>
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
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

    // DynamoDB: full CRUD on the tino table and its GSI
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
        ],
        resources: [
          table.tableArn,
          `${table.tableArn}/index/*`,
        ],
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
    });

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

    taskDefinition.addContainer('tino', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        PERSISTENCE_ADAPTER: 'dynamodb',
        DYNAMODB_TABLE_NAME: table.tableName,
      },
      secrets: containerSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'tino',
        logGroup,
      }),
      essential: true,
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
    });

    // Suppress unused variable warning — service is referenced for outputs
    void service;

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

    new cdk.CfnOutput(this, 'DynamoTableName', {
      value: table.tableName,
      description: 'DynamoDB table name for tino persistence',
    });
  }
}
