import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

export interface TinoServiceArgs {
  /**
   * VPC to deploy into. If not provided, uses the default VPC.
   * Accepts a VPC object or a VPC ID string.
   */
  vpc?: aws.ec2.Vpc | pulumi.Input<string>;

  /**
   * Subnets for the ECS task. If not provided, discovers private subnets
   * in the VPC (falls back to all subnets if no private subnets exist).
   */
  subnets?: pulumi.Input<string>[];

  /**
   * ECS cluster. If not provided, creates a new one.
   */
  cluster?: aws.ecs.Cluster;

  /**
   * Docker image URI. If not provided, builds from the Dockerfile at the
   * repo root and pushes to a created ECR repo.
   *
   * For development: pass a pre-built image to skip the build.
   * For production: omit this and let the component build + push.
   */
  image?: pulumi.Input<string>;

  /**
   * Path to the Dockerfile context (repo root). Default: "." (current directory).
   * Only used when `image` is not provided.
   */
  dockerContext?: string;

  /**
   * Regulatory compliance configuration. Security controls (encryption, PITR,
   * audit alarms, least-privilege IAM, etc.) are ALWAYS on regardless of these
   * flags. The compliance flags add framework-specific checks and resource tags
   * that auditors use to identify in-scope resources.
   *
   * Defaults: hipaa=true, soc2=true, gdpr=false, hitrust=false.
   */
  compliance?: {
    /**
     * HIPAA (Health Insurance Portability and Accountability Act). Default: true.
     * Adds: BAA verification reminder (logged as a Pulumi warning), "compliance:hipaa"
     * tags, Container Insights.
     *
     * The reminder instructs the deployer to verify a signed BAA in AWS Artifact.
     * There is no programmatic AWS API to confirm BAA status, so the check is
     * advisory only.
     */
    hipaa?: boolean;

    /**
     * SOC 2 Type II. Default: true.
     * Adds: "compliance:soc2" tags. Logs a Pulumi warning reminding the deployer
     * to enable VPC Flow Logs on the VPC (required for SOC 2 CC6.1 network
     * monitoring). The Pulumi AWS provider does not expose a read-only flow-log
     * lookup, so detection is not possible — the warning is always emitted.
     */
    soc2?: boolean;

    /**
     * GDPR (General Data Protection Regulation). Default: false.
     * Adds: "compliance:gdpr" tags, restricts the Bedrock IAM policy to the
     * current region only (preventing cross-region inference calls), reduces
     * CloudWatch log retention to 30 days (right-to-erasure for application
     * logs), and logs reminders about cross-region inference profiles and
     * application-level data retention.
     *
     * Enable if tino processes data from EU users or employees.
     */
    gdpr?: boolean;

    /**
     * HITRUST CSF. Default: false.
     * Adds: "compliance:hitrust" tags. HITRUST is a superset of HIPAA —
     * enabling this implies hipaa=true regardless of the hipaa flag.
     */
    hitrust?: boolean;
  };

  /**
   * ECS task CPU units. Default: "256" (0.25 vCPU).
   */
  cpu?: string;

  /**
   * ECS task memory MiB. Default: "512".
   */
  memory?: string;

  /**
   * Additional CloudWatch log group ARNs the CloudWatch tool can query.
   * If not provided, the tool can only query tino's own log group.
   * Add your application log groups here to enable the CloudWatch capability.
   *
   * Example:
   *   cloudwatchLogGroupArns: [
   *     "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/my-app",
   *   ]
   */
  cloudwatchLogGroupArns?: pulumi.Input<string>[];

  /**
   * Enable ECS Exec (shell access to the container). Default: false.
   * Enable for debugging only — disable in production.
   * When enabled, exec into the container via:
   *   aws ecs execute-command --cluster <cluster> --task <task> --container tino --interactive --command /bin/sh
   */
  enableExec?: boolean;

  /**
   * Tags applied to all resources.
   */
  tags?: Record<string, string>;
}

/**
 * Discover subnets for a VPC. Prefers private subnets (map-public-ip-on-launch=false).
 * Falls back to all subnets in the VPC if no private subnets are found.
 */
function discoverSubnets(vpcId: pulumi.Input<string>): pulumi.Output<string[]> {
  const privateSubnets = aws.ec2.getSubnetsOutput({
    filters: [
      { name: "vpc-id", values: [vpcId] },
      { name: "map-public-ip-on-launch", values: ["false"] },
    ],
  });

  // When there are no private subnets, fall back to all subnets in the VPC.
  // We use pulumi.all to flatten the conditional Output<string[]> result.
  return privateSubnets.ids.apply(ids => {
    if (ids.length > 0) {
      return pulumi.output(ids);
    }
    return aws.ec2.getSubnetsOutput({
      filters: [{ name: "vpc-id", values: [vpcId] }],
    }).ids;
  }).apply(ids => ids as string[]);
}

/**
 * TinoService — a Pulumi component that provisions all AWS infrastructure
 * needed to run the Tino Slack assistant.
 *
 * Security posture:
 * - All IAM policies are least-privilege (no wildcard resources except where
 *   AWS requires it, e.g. ecr:GetAuthorizationToken).
 * - DynamoDB deletion protection is enabled — `pulumi destroy` will fail on
 *   the table until you manually disable it.
 * - ECR image tags are immutable — use digest-addressed image URIs in the
 *   task definition (the built image URI already includes the digest).
 * - ECS Exec is disabled by default — enable via `enableExec: true` for
 *   debugging only.
 * - Container root filesystem is read-only; /tmp is mounted as an ephemeral
 *   volume for Node.js scratch space.
 * - SNS topic is encrypted with the component's KMS key.
 * - Container Insights is always enabled for audit trail depth.
 *
 * Compliance behaviour (when flags are set):
 * - HIPAA: logs a Pulumi warning reminding the deployer to verify a signed BAA
 *   in AWS Artifact. No programmatic BAA check exists in the AWS API.
 * - SOC 2: logs a Pulumi warning reminding the deployer to enable VPC Flow Logs
 *   (required for CC6.1 network monitoring). Detection is not possible via the
 *   Pulumi AWS provider, so the reminder is always emitted.
 * - GDPR: restricts the Bedrock IAM policy to the current region (prevents
 *   cross-region inference calls), reduces CloudWatch log retention to 30 days
 *   (right-to-erasure for application logs), and logs reminders about
 *   cross-region inference profiles and application-level data retention.
 */
export class TinoService extends pulumi.ComponentResource {
  /** The DynamoDB table name. */
  public readonly tableName: pulumi.Output<string>;

  /** The ECS cluster name. */
  public readonly clusterName: pulumi.Output<string>;

  /** The ECS service name. */
  public readonly serviceName: pulumi.Output<string>;

  /** The ECR repository URI. */
  public readonly ecrRepoUri: pulumi.Output<string>;

  /** The KMS key ARN. */
  public readonly kmsKeyArn: pulumi.Output<string>;

  /**
   * The SNS topic ARN for security alerts.
   * Subscribe via the AWS console or CLI — the component does not manage subscriptions.
   */
  public readonly alertTopicArn: pulumi.Output<string>;

  /** The CloudWatch log group name. */
  public readonly logGroupName: pulumi.Output<string>;

  /** The built/pushed image URI used by the ECS task. */
  public readonly imageUri: pulumi.Output<string>;

  /**
   * Reminder of how to exec into the running container for console access.
   * Only available when `enableExec: true` is set.
   * Example: aws ecs execute-command --cluster <cluster> --task <task-id> --container tino --interactive --command /bin/sh
   */
  public readonly consoleNote: pulumi.Output<string>;

  constructor(name: string, args?: TinoServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super("tino:aws:TinoService", name, {}, opts);

    const hipaaCompliance = args?.compliance?.hipaa !== false; // default true
    const soc2Compliance = args?.compliance?.soc2 !== false;   // default true
    const gdprCompliance = args?.compliance?.gdpr === true;    // default false
    const hitrustCompliance = args?.compliance?.hitrust === true; // default false

    // HITRUST is a superset of HIPAA — if HITRUST is on, HIPAA is on
    const effectiveHipaa = hipaaCompliance || hitrustCompliance;

    const complianceTags: Record<string, string> = {};
    if (effectiveHipaa) complianceTags["compliance:hipaa"] = "true";
    if (soc2Compliance) complianceTags["compliance:soc2"] = "true";
    if (gdprCompliance) complianceTags["compliance:gdpr"] = "true";
    if (hitrustCompliance) complianceTags["compliance:hitrust"] = "true";

    const tags = { ...args?.tags, "tino:managed": "true", ...complianceTags };

    // ── Compliance warnings ───────────────────────────────────────────────
    // These run during `pulumi preview` and `pulumi up`.

    // HIPAA: remind the deployer to verify a signed BAA.
    // There is no AWS API that confirms BAA status programmatically; the
    // reminder is the most honest implementation possible.
    if (effectiveHipaa) {
      pulumi.log.warn(
        `HIPAA compliance is enabled. Verify that your AWS account has a signed BAA:\n` +
        `  AWS Console → Artifact → Agreements → AWS Business Associate Addendum\n` +
        `  https://console.aws.amazon.com/artifact/\n` +
        `  Without a BAA, this deployment may violate HIPAA requirements.`,
        this,
      );
    }

    // SOC 2: remind the deployer to enable VPC Flow Logs.
    // The Pulumi AWS provider does not expose a read-only flow-log lookup
    // (aws.ec2.getFlowLogs does not exist), so we always emit the reminder.
    if (soc2Compliance) {
      pulumi.log.warn(
        `SOC 2 compliance is enabled. Ensure VPC Flow Logs are enabled on your VPC.\n` +
        `  Required for SOC 2 CC6.1 (network monitoring).\n` +
        `  If using an existing VPC, verify flow logs are already configured.\n` +
        `  To add flow logs: aws.ec2.FlowLog or your existing IaC.`,
        this,
      );
    }

    // GDPR: warn about cross-region Bedrock inference profiles.
    // The IAM policy below enforces single-region Bedrock access when GDPR is
    // on, but the model ID itself is configured at runtime — remind the deployer.
    if (gdprCompliance) {
      pulumi.log.warn(
        `GDPR compliance is enabled. Ensure your Bedrock model uses a single-region inference profile\n` +
        `  (e.g., us.anthropic.claude-sonnet-4-6), NOT a global profile (e.g., global.anthropic.claude-sonnet-4-6).\n` +
        `  Global profiles route requests across regions, which may violate GDPR data residency requirements.\n` +
        `  Configure the model ID in tino's console after deployment.`,
        this,
      );
      pulumi.log.warn(
        `GDPR compliance is enabled. Ensure tino's application-level data retention is configured:\n` +
        `  - Conversation history: 30 days (right to erasure)\n` +
        `  - Audit logs: 90 days\n` +
        `  Configure via tino's console → Compliance section after deployment.`,
        this,
      );
    }

    // ── VPC ──────────────────────────────────────────────────────────────
    // Use provided VPC (object or ID string), or discover the default VPC.
    const vpcId: pulumi.Input<string> = (() => {
      if (!args?.vpc) {
        return aws.ec2.getVpcOutput({ default: true }).id;
      }
      if (typeof args.vpc === "string") {
        return args.vpc;
      }
      // pulumi.Input<string> or aws.ec2.Vpc object
      if (args.vpc instanceof aws.ec2.Vpc) {
        return args.vpc.id;
      }
      // pulumi.Input<string> (Output<string> or Promise<string>)
      return args.vpc as pulumi.Input<string>;
    })();

    // ── Subnets ───────────────────────────────────────────────────────────
    // Use provided subnets, or discover private subnets (falling back to all).
    const subnetIds: pulumi.Input<pulumi.Input<string>[]> =
      args?.subnets ?? discoverSubnets(vpcId);

    // ── KMS key (always) ─────────────────────────────────────────────────
    const kmsKey = new aws.kms.Key(`${name}-kms`, {
      description: `tino encryption key (${name})`,
      enableKeyRotation: true,
      tags,
    }, { parent: this });

    new aws.kms.Alias(`${name}-kms-alias`, {
      name: `alias/tino-${name}`,
      targetKeyId: kmsKey.id,
    }, { parent: this });

    this.kmsKeyArn = kmsKey.arn;

    // ── DynamoDB table ───────────────────────────────────────────────────
    // Runtime config (credentials, model ID, Slack tokens) lives here.
    // Managed via the console — not in this component.
    // deletionProtectionEnabled: true prevents accidental `pulumi destroy`.
    // To destroy the table, disable deletion protection in the console first.
    const table = new aws.dynamodb.Table(`${name}-table`, {
      name: `tino-${name}`,
      billingMode: "PAY_PER_REQUEST",
      hashKey: "pk",
      rangeKey: "sk",
      attributes: [
        { name: "pk", type: "S" },
        { name: "sk", type: "S" },
        { name: "gsi1pk", type: "S" },
        { name: "gsi1sk", type: "S" },
      ],
      globalSecondaryIndexes: [{
        name: "gsi1",
        hashKey: "gsi1pk",
        rangeKey: "gsi1sk",
        projectionType: "ALL",
      }],
      pointInTimeRecovery: { enabled: true },
      ttl: { attributeName: "ttl", enabled: true },
      serverSideEncryption: { enabled: true, kmsKeyArn: kmsKey.arn },
      deletionProtectionEnabled: true,
      tags,
    }, { parent: this });

    this.tableName = table.name;

    // ── CloudWatch log group ─────────────────────────────────────────────
    // GDPR right-to-erasure: application logs are retained for 30 days.
    // Non-GDPR deployments retain logs for 90 days.
    const logRetentionDays = gdprCompliance ? 30 : 90;
    const logGroup = new aws.cloudwatch.LogGroup(`${name}-logs`, {
      name: `/ecs/tino-${name}`,
      retentionInDays: logRetentionDays,
      kmsKeyId: kmsKey.arn,
      tags,
    }, { parent: this });

    this.logGroupName = logGroup.name;

    // ── Security alarms (always) ─────────────────────────────────────────
    // SNS topic is created; subscriptions are managed via the console.
    // Encrypted with the component's KMS key.
    const snsTopic = new aws.sns.Topic(`${name}-alerts`, {
      name: `tino-${name}-security-alerts`,
      kmsMasterKeyId: kmsKey.id,
      tags,
    }, { parent: this });

    this.alertTopicArn = snsTopic.arn;

    const metricFilter = new aws.cloudwatch.LogMetricFilter(`${name}-security-events`, {
      logGroupName: logGroup.name,
      pattern: '"access_denied" OR "auth_error" OR "permission_denied" OR "injection_suspected"',
      metricTransformation: {
        name: `tino-${name}-security-events`,
        namespace: "Tino/Security",
        value: "1",
      },
    }, { parent: this });

    new aws.cloudwatch.MetricAlarm(`${name}-security-alarm`, {
      name: `tino-${name}-security-events`,
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      metricName: metricFilter.metricTransformation.name,
      namespace: "Tino/Security",
      period: 900, // 15 minutes
      statistic: "Sum",
      threshold: 5,
      alarmActions: [snsTopic.arn],
      tags,
    }, { parent: this });

    // ── ECR repository ───────────────────────────────────────────────────
    // imageTagMutability: IMMUTABLE prevents overwriting existing tags.
    // The built image URI includes the digest, so `latest` is never used.
    const ecrRepo = new aws.ecr.Repository(`${name}-ecr`, {
      name: `tino-${name}`,
      forceDelete: false,
      imageScanningConfiguration: { scanOnPush: true },
      imageTagMutability: "IMMUTABLE",
      tags,
    }, { parent: this });

    this.ecrRepoUri = ecrRepo.repositoryUrl;

    // ── Docker image ─────────────────────────────────────────────────────
    // If an image URI is provided, use it directly (dev/CI shortcut).
    // Otherwise, build from the Dockerfile and push to ECR.
    // The awsx.ecr.Image resource returns a digest-addressed URI
    // (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/tino@sha256:abc123),
    // which is compatible with IMMUTABLE tag enforcement.
    let resolvedImageUri: pulumi.Output<string>;
    if (args?.image) {
      resolvedImageUri = pulumi.output(args.image);
    } else {
      const builtImage = new awsx.ecr.Image(`${name}-image`, {
        repositoryUrl: ecrRepo.repositoryUrl,
        context: args?.dockerContext ?? ".",
        platform: "linux/amd64",
      }, { parent: this });
      resolvedImageUri = builtImage.imageUri;
    }

    this.imageUri = resolvedImageUri;

    // ── IAM roles ────────────────────────────────────────────────────────
    const taskExecutionRole = new aws.iam.Role(`${name}-exec-role`, {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "ecs-tasks.amazonaws.com" },
        }],
      }),
      tags,
    }, { parent: this });

    // Execution role: custom policy — ECR pull + CloudWatch Logs write only.
    // Replaces the broad AmazonECSTaskExecutionRolePolicy managed policy.
    new aws.iam.RolePolicy(`${name}-exec-policy`, {
      role: taskExecutionRole.name,
      policy: pulumi.all([ecrRepo.arn, logGroup.arn]).apply(([ecrArn, logArn]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
              ],
              Resource: [ecrArn],
            },
            {
              // GetAuthorizationToken does not support resource-level permissions.
              Effect: "Allow",
              Action: ["ecr:GetAuthorizationToken"],
              Resource: ["*"],
            },
            {
              Effect: "Allow",
              Action: [
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              Resource: [logArn, `${logArn}:*`],
            },
          ],
        }),
      ),
    }, { parent: this });

    const taskRole = new aws.iam.Role(`${name}-task-role`, {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "ecs-tasks.amazonaws.com" },
        }],
      }),
      tags,
    }, { parent: this });

    // Task role: DynamoDB (config store + app data), Bedrock, KMS, CloudWatch Logs.
    // All resources are scoped — no wildcards except where AWS requires it.
    // GDPR: Bedrock resources are restricted to the current region only, preventing
    // cross-region inference calls that could violate data residency requirements.
    const extraLogGroupArns: pulumi.Input<string>[] = args?.cloudwatchLogGroupArns ?? [];
    const region = aws.config.region ?? "us-east-1";
    const bedrockResources = gdprCompliance
      ? [
          `arn:aws:bedrock:${region}:*:inference-profile/*`,
          `arn:aws:bedrock:${region}::foundation-model/*`,
        ]
      : [
          "arn:aws:bedrock:*:*:inference-profile/*",
          "arn:aws:bedrock:*::foundation-model/*",
        ];
    new aws.iam.RolePolicy(`${name}-task-policy`, {
      role: taskRole.name,
      policy: pulumi.all([table.arn, kmsKey.arn, logGroup.arn, ...extraLogGroupArns]).apply(
        (resolved) => {
          const tableArn = resolved[0] as string;
          const kmsArn = resolved[1] as string;
          const logArn = resolved[2] as string;
          // Any additional log group ARNs start at index 3.
          const extraArns = (resolved as string[]).slice(3);

          // CloudWatch Logs resources: tino's own log group + user-provided ones.
          // The CloudWatch tool's own allowlist is the application-level access
          // control; IAM scopes which log groups are reachable at all.
          const cwResources: string[] = [logArn, `${logArn}:*`];
          for (const arn of extraArns) {
            cwResources.push(arn, `${arn}:*`);
          }

          const statements: object[] = [
            // DynamoDB — config store + conversation history
            {
              Effect: "Allow",
              Action: [
                "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
                "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
              ],
              Resource: [tableArn, `${tableArn}/index/*`],
            },
            // Bedrock — scoped to inference profiles and foundation models.
            // Model IDs are configured at runtime (not known at deploy time).
            // When GDPR is enabled, resources are restricted to the current
            // region to prevent cross-region inference calls.
            {
              Effect: "Allow",
              Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
              Resource: bedrockResources,
            },
            // CloudWatch Logs — for CloudWatch tool queries.
            // Scoped to tino's own log group + any user-provided log groups.
            // To query additional log groups, add their ARNs to cloudwatchLogGroupArns.
            {
              Effect: "Allow",
              Action: ["logs:StartQuery", "logs:GetQueryResults", "logs:StopQuery"],
              Resource: cwResources,
            },
            // KMS — encrypt/decrypt DynamoDB data
            {
              Effect: "Allow",
              Action: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"],
              Resource: [kmsArn],
            },
          ];

          return JSON.stringify({ Version: "2012-10-17", Statement: statements });
        },
      ),
    }, { parent: this });

    // ── ECS cluster (create or reuse) ────────────────────────────────────
    // Container Insights is always enabled for audit trail depth.
    const cluster = args?.cluster ?? new aws.ecs.Cluster(`${name}-cluster`, {
      name: `tino-${name}`,
      settings: [{ name: "containerInsights", value: "enabled" }],
      tags,
    }, { parent: this });

    this.clusterName = cluster.name;

    // ── ECS security group ───────────────────────────────────────────────
    // No ingress — Tino uses Slack Socket Mode (outbound WebSocket only).
    const sg = new aws.ec2.SecurityGroup(`${name}-sg`, {
      vpcId,
      description: "tino ECS task — outbound only (Socket Mode)",
      egress: [{
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
        description: "Allow all outbound (Slack WSS, Bedrock, external APIs)",
      }],
      tags,
    }, { parent: this });

    // ── ECS task definition ──────────────────────────────────────────────
    // All runtime config (credentials, model ID, Slack tokens) is read from
    // the DynamoDB config store at startup. No secrets in the task definition.
    //
    // readonlyRootFilesystem: true — container cannot write to its root FS.
    // /tmp is mounted as an ephemeral volume for Node.js scratch space.
    const taskDef = new aws.ecs.TaskDefinition(`${name}-task`, {
      family: `tino-${name}`,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: args?.cpu ?? "256",
      memory: args?.memory ?? "512",
      executionRoleArn: taskExecutionRole.arn,
      taskRoleArn: taskRole.arn,
      // Ephemeral volume for /tmp (required when readonlyRootFilesystem is true).
      volumes: [{
        name: "tmp",
        // Fargate ephemeral storage — no host path needed.
      }],
      containerDefinitions: pulumi.all([resolvedImageUri, logGroup.name]).apply(
        ([image, logName]) => JSON.stringify([{
          name: "tino",
          image,
          essential: true,
          readonlyRootFilesystem: true,
          mountPoints: [{
            sourceVolume: "tmp",
            containerPath: "/tmp",
            readOnly: false,
          }],
          environment: [
            { name: "NODE_ENV", value: "production" },
            { name: "PERSISTENCE_ADAPTER", value: "dynamodb" },
            { name: "DYNAMODB_TABLE_NAME", value: `tino-${name}` },
            { name: "DYNAMODB_ENDPOINT", value: "" }, // empty = use real AWS
            { name: "LOG_LEVEL", value: "info" },
          ],
          // No secrets block — credentials come from the DynamoDB config store
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logName,
              "awslogs-region": aws.config.region ?? "us-east-1",
              "awslogs-stream-prefix": "tino",
            },
          },
        }]),
      ),
      tags,
    }, { parent: this });

    // ── ECS service ──────────────────────────────────────────────────────
    // enableExecuteCommand defaults to false (secure default).
    // Set enableExec: true in args to enable for debugging.
    const service = new aws.ecs.Service(`${name}-service`, {
      name: `tino-${name}`,
      cluster: cluster.arn,
      taskDefinition: taskDef.arn,
      desiredCount: 1,
      launchType: "FARGATE",
      networkConfiguration: {
        subnets: subnetIds,
        securityGroups: [sg.id],
        assignPublicIp: false,
      },
      enableExecuteCommand: args?.enableExec ?? false,
      tags,
    }, { parent: this });

    this.serviceName = service.name;

    // ── Console access note ──────────────────────────────────────────────
    this.consoleNote = pulumi.all([cluster.name, service.name]).apply(
      ([clusterName, serviceName]) =>
        `ECS Exec is ${args?.enableExec ? "enabled" : "disabled"}.\n` +
        (args?.enableExec
          ? `Access the running container:\n` +
            `  1. Find the task ID: aws ecs list-tasks --cluster ${clusterName} --service-name ${serviceName}\n` +
            `  2. Exec in:          aws ecs execute-command --cluster ${clusterName} --task <task-id> --container tino --interactive --command /bin/sh`
          : `To enable, set enableExec: true in TinoServiceArgs (debugging only).`),
    );

    this.registerOutputs({
      tableName: this.tableName,
      clusterName: this.clusterName,
      serviceName: this.serviceName,
      ecrRepoUri: this.ecrRepoUri,
      kmsKeyArn: this.kmsKeyArn,
      alertTopicArn: this.alertTopicArn,
      logGroupName: this.logGroupName,
      imageUri: this.imageUri,
      consoleNote: this.consoleNote,
    });
  }
}
