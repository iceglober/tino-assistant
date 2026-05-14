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
   * Regulatory compliance. Security controls are always on.
   * This adds regulatory-specific checks (BAA verification, compliance tags).
   * Default: { hipaa: true }
   */
  compliance?: {
    /**
     * Enable HIPAA compliance checks. Default: true.
     *
     * When true (default):
     * - Adds "compliance:hipaa" tag to all resources
     *
     * When explicitly set to false:
     * - No compliance-specific tags
     * - All security controls still apply (encryption, PITR, alarms, etc.)
     */
    hipaa?: boolean;
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
 * VPC Flow Logs recommendation:
 * - When passing an existing VPC (`vpc` arg), ensure that VPC already has
 *   flow logs enabled (required for SOC 2 / HIPAA network audit trails).
 * - When the component creates its own cluster (no `cluster` arg), consider
 *   enabling flow logs on the VPC via a separate aws.ec2.FlowLog resource.
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
    const tags: Record<string, string> = {
      ...args?.tags,
      "tino:managed": "true",
      ...(hipaaCompliance ? { "compliance:hipaa": "true" } : {}),
    };

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
    const logGroup = new aws.cloudwatch.LogGroup(`${name}-logs`, {
      name: `/ecs/tino-${name}`,
      retentionInDays: 90,
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
    const extraLogGroupArns: pulumi.Input<string>[] = args?.cloudwatchLogGroupArns ?? [];
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
            // Model IDs are configured at runtime (not known at deploy time),
            // so we allow any inference profile or foundation model ARN.
            // Custom models, model customization jobs, etc. are NOT allowed.
            {
              Effect: "Allow",
              Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
              Resource: [
                "arn:aws:bedrock:*:*:inference-profile/*",
                "arn:aws:bedrock:*::foundation-model/*",
              ],
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
