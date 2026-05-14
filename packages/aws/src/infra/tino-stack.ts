import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
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

    // ── CDK Context ───────────────────────────────────────────────────────────
    // Configurable via cdk.json context or --context flag:
    //   npx cdk synth --context logRetentionDays=180
    //   npx cdk synth --context alarmEmail=ops@example.com
    const logRetentionDays: number =
      (this.node.tryGetContext('logRetentionDays') as number | undefined) ?? 90;
    const alarmEmail: string | undefined = this.node.tryGetContext('alarmEmail') as
      | string
      | undefined;

    // ── VPC ──────────────────────────────────────────────────────────────────
    // Use the account's default VPC. If no default VPC exists, cdk deploy will
    // fail with a clear error. Create one with: aws ec2 create-default-vpc
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // ── ECR Repository ───────────────────────────────────────────────────────
    const ecrRepo = new ecr.Repository(this, 'TinoRepo', {
      repositoryName: 'tino',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── KMS Customer-Managed Key ─────────────────────────────────────────────
    // HIPAA: customer-managed key for DynamoDB, Secrets Manager, and CloudWatch
    // Logs. Key policy is set after the task role is created (see below).
    const tinoKey = new kms.Key(this, 'TinoKey', {
      alias: 'alias/tino',
      description: 'tino HIPAA CMK — encrypts DynamoDB, Secrets Manager, CloudWatch Logs',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── DynamoDB Table ───────────────────────────────────────────────────────
    // HIPAA hardening:
    //   - CUSTOMER_MANAGED encryption with the tino KMS key
    //   - pointInTimeRecovery: required for HIPAA contingency plan (45 CFR § 164.308(a)(7))
    //   - timeToLiveAttribute: automatic data retention (audit logs, conversation history)
    const table = new dynamodb.Table(this, 'TinoTable', {
      tableName: 'tino',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: tinoKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // GSI1: partition by task status, sort by scheduledAt (zero-padded string)
    // Enables listPending: gsi1pk=TASK_STATUS#pending AND gsi1sk <= <now>
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // ── CloudWatch Log Group ─────────────────────────────────────────────────
    // HIPAA: encrypted with CMK, configurable retention (default 90 days).
    const retentionMap: Record<number, logs.RetentionDays> = {
      1: logs.RetentionDays.ONE_DAY,
      3: logs.RetentionDays.THREE_DAYS,
      5: logs.RetentionDays.FIVE_DAYS,
      7: logs.RetentionDays.ONE_WEEK,
      14: logs.RetentionDays.TWO_WEEKS,
      30: logs.RetentionDays.ONE_MONTH,
      60: logs.RetentionDays.TWO_MONTHS,
      90: logs.RetentionDays.THREE_MONTHS,
      120: logs.RetentionDays.FOUR_MONTHS,
      150: logs.RetentionDays.FIVE_MONTHS,
      180: logs.RetentionDays.SIX_MONTHS,
      365: logs.RetentionDays.ONE_YEAR,
      400: logs.RetentionDays.THIRTEEN_MONTHS,
      545: logs.RetentionDays.EIGHTEEN_MONTHS,
      731: logs.RetentionDays.TWO_YEARS,
      1827: logs.RetentionDays.FIVE_YEARS,
      3653: logs.RetentionDays.TEN_YEARS,
    };
    const retention =
      retentionMap[logRetentionDays] ?? logs.RetentionDays.THREE_MONTHS;

    const logGroup = new logs.LogGroup(this, 'TinoLogGroup', {
      logGroupName: '/ecs/tino',
      retention,
      encryptionKey: tinoKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── SNS Topic for Security Alarms ────────────────────────────────────────
    // HIPAA: breach notification — admin subscribes their email during tino init.
    const alarmTopic = new sns.Topic(this, 'TinoAlarmTopic', {
      topicName: 'tino-security-alarms',
      displayName: 'tino Security Alarms',
    });

    if (alarmEmail) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(alarmEmail));
    }

    // ── Security Metric Filter ───────────────────────────────────────────────
    // HIPAA: detect access_denied / auth_error / permission_denied events.
    const securityMetricFilter = new logs.MetricFilter(
      this,
      'TinoSecurityMetricFilter',
      {
        logGroup,
        metricNamespace: 'Tino/Security',
        metricName: 'SecurityEvents',
        filterPattern: logs.FilterPattern.anyTerm(
          'access_denied',
          'auth_error',
          'permission_denied',
        ),
        metricValue: '1',
        defaultValue: 0,
      },
    );

    // ── Security Alarm ───────────────────────────────────────────────────────
    // HIPAA: alarm fires when >5 security events occur in a 15-minute window.
    const securityAlarm = new cloudwatch.Alarm(this, 'TinoSecurityAlarm', {
      alarmName: 'tino-security-events',
      alarmDescription:
        'Fires when >5 access_denied/auth_error/permission_denied events occur in 15 minutes',
      metric: securityMetricFilter.metric({
        period: cdk.Duration.minutes(15),
        statistic: 'Sum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    securityAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(alarmTopic),
    );

    // ── ECS Cluster ──────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'TinoCluster', { vpc });

    // ── Task Role ────────────────────────────────────────────────────────────
    const taskRole = new iam.Role(this, 'TinoTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'tino ECS task role — scoped to specific resource ARNs',
    });

    // Bedrock: invoke the configured model (scoped to foundation-model ARNs)
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockInvokeModel',
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/*`,
          // Cross-region inference profiles
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        ],
      }),
    );

    // DynamoDB: CRUD on the tino table and its GSI (scoped to table ARN)
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DynamoDBCrud',
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
        ],
        resources: [table.tableArn, `${table.tableArn}/index/*`],
      }),
    );

    // KMS: encrypt/decrypt with the tino key (for envelope encryption of personal tokens)
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'KmsEnvelopeEncryption',
        actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey'],
        resources: [tinoKey.keyArn],
      }),
    );

    // CloudWatch Logs: query access for the CloudWatch tool
    // MVP: logs:* scoped to the tino log group; extend allowlist as needed.
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogsQuery',
        actions: [
          'logs:StartQuery',
          'logs:GetQueryResults',
          'logs:StopQuery',
          'logs:DescribeLogGroups',
          'logs:FilterLogEvents',
        ],
        resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
      }),
    );

    // ── Grant KMS key usage to the task role ─────────────────────────────────
    // CDK's grantEncryptDecrypt adds the task role to the key policy.
    tinoKey.grantEncryptDecrypt(taskRole);

    // ── Execution Role ───────────────────────────────────────────────────────
    const executionRole = new iam.Role(this, 'TinoExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'tino ECS execution role — ECR pull + SSM/Secrets Manager read + CW Logs write',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    // SSM: read all /tino/* parameters at task startup (scoped to specific ARNs)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SsmReadTinoParams',
        actions: ['ssm:GetParameters', 'ssm:GetParameter'],
        resources: Object.values(SSM_PARAMS).map(
          (name) =>
            `arn:aws:ssm:${this.region}:${this.account}:parameter${name}`,
        ),
      }),
    );

    // KMS: decrypt SecureString SSM parameters (via SSM service)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'KmsDecryptSsmParams',
        actions: ['kms:Decrypt'],
        resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
        conditions: {
          StringEquals: {
            'kms:ViaService': `ssm.${this.region}.amazonaws.com`,
          },
        },
      }),
    );

    // CloudWatch Logs: write container logs (scoped to the tino log group)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogsWrite',
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogStreams',
        ],
        resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
      }),
    );

    // ── Secrets Manager (encrypted with CMK) ─────────────────────────────────
    // HIPAA: org-level secrets encrypted with the tino KMS key (not AWS-managed).
    // These are created as placeholders; actual values are set by tino init.
    const slackBotTokenSecret = new secretsmanager.Secret(
      this,
      'SlackBotTokenSecret',
      {
        secretName: '/tino/secrets/slack-bot-token',
        description: 'tino Slack bot token (xoxb-)',
        encryptionKey: tinoKey,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    );

    const slackAppTokenSecret = new secretsmanager.Secret(
      this,
      'SlackAppTokenSecret',
      {
        secretName: '/tino/secrets/slack-app-token',
        description: 'tino Slack app token (xapp-)',
        encryptionKey: tinoKey,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    );

    // Grant execution role read access to the secrets (scoped to specific ARNs)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManagerReadTinoSecrets',
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
        ],
        resources: [
          slackBotTokenSecret.secretArn,
          slackAppTokenSecret.secretArn,
        ],
      }),
    );

    // Grant KMS decrypt for Secrets Manager to the execution role
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'KmsDecryptSecretsManager',
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: [tinoKey.keyArn],
        conditions: {
          StringEquals: {
            'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com`,
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
        KMS_KEY_ID: tinoKey.keyArn,
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
    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value: tinoKey.keyArn,
      description: 'tino KMS CMK ARN (alias/tino)',
      exportName: 'TinoKmsKeyArn',
    });

    new cdk.CfnOutput(this, 'EcrRepoUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR repository URI for the tino container image',
      exportName: 'TinoEcrRepoUri',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
      exportName: 'TinoClusterName',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: service.serviceName,
      description: 'ECS service name',
      exportName: 'TinoServiceName',
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch log group for tino container logs',
      exportName: 'TinoLogGroupName',
    });

    new cdk.CfnOutput(this, 'DynamoTableName', {
      value: table.tableName,
      description: 'DynamoDB table name for tino persistence',
      exportName: 'TinoDynamoTableName',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic ARN for tino security alarms',
      exportName: 'TinoAlarmTopicArn',
    });
  }
}
