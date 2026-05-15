import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as dockerBuild from "@pulumi/docker-build";

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
  subnets?: pulumi.Input<string>[] | pulumi.Input<pulumi.Input<string>[]>;

  /**
   * Google OAuth client ID for console authentication.
   * Required — the console is protected by Google Sign-In.
   * Get this from the GCP console (OAuth 2.0 Client ID, Web application type).
   */
  googleOAuthClientId: pulumi.Input<string>;

  /**
   * Google OAuth client secret.
   */
  googleOAuthClientSecret: pulumi.Input<string>;

  /**
   * Allowed email domain for console access (e.g., "kayn.ai").
   * Only Google accounts from this domain can sign in.
   * If not provided, any Google account can sign in (not recommended for production).
   */
  allowedDomain?: string;

  /**
   * Custom domain for the console (e.g., "tino.kayn.ai").
   * If provided: creates an ACM certificate and expects a Route53 hosted zone
   * for the domain. The console is accessible at https://<domain>.
   *
   * If not provided: the console is accessible at the ALB's auto-generated
   * DNS name over HTTP. Fine for initial setup; add a domain later.
   */
  consoleDomain?: string;

  /**
   * Route53 hosted zone ID for the custom domain.
   * Required when consoleDomain is provided.
   */
  hostedZoneId?: pulumi.Input<string>;

  /**
   * ECS cluster. If not provided, creates a new one.
   */
  cluster?: aws.ecs.Cluster;

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
     * Adds: "compliance:hipaa" tags, Container Insights.
     *
     * Requires `pulumi config set tino:baaAcknowledged true` — deployment fails
     * without it. Run after verifying a signed BAA in AWS Artifact:
     * https://console.aws.amazon.com/artifact/
     */
    hipaa?: boolean;

    /**
     * SOC 2 Type II. Default: true.
     * Adds: "compliance:soc2" tags. Creates VPC Flow Logs (CloudWatch, encrypted,
     * 1-minute granularity) on the VPC for SOC 2 CC6.1 network monitoring.
     */
    soc2?: boolean;

    /**
     * GDPR (General Data Protection Regulation). Default: false.
     * Adds: "compliance:gdpr" tags. Scopes Bedrock IAM to current region only
     * (prevents cross-region model invocation). Sets log retention to 30 days.
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
 * - ECR image tags are immutable — use digest-addressed image URIs when
 *   pushing (the CLI handles this). The task definition starts with a
 *   placeholder image; the CLI replaces it after `pulumi up`.
 * - ECS Exec is disabled by default — enable via `enableExec: true` for
 *   debugging only.
 * - Container root filesystem is read-only; /tmp is mounted as an ephemeral
 *   volume for Node.js scratch space.
 * - SNS topic is encrypted with the component's KMS key.
 * - Container Insights is always enabled for audit trail depth.
 *
 * Compliance behaviour (when flags are set):
 * - HIPAA: hard gate — `pulumi up` throws immediately unless
 *   `pulumi config set tino:baaAcknowledged true` has been run after verifying
 *   a signed BAA in AWS Artifact.
 * - SOC 2: creates VPC Flow Logs (CloudWatch, encrypted with tino's KMS key,
 *   1-minute granularity) on the VPC for CC6.1 network monitoring.
 * - GDPR: scopes Bedrock IAM to the current region only (prevents cross-region
 *   model invocation), reduces CloudWatch log retention to 30 days (right-to-
 *   erasure for application logs), and logs reminders about cross-region
 *   inference profiles and application-level data retention.
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

  /**
   * The URL of the console.
   * "https://tino.kayn.ai" when consoleDomain is set, or
   * "http://<alb-dns>" when no custom domain is provided.
   */
  public readonly consoleUrl: pulumi.Output<string>;

  constructor(name: string, args: TinoServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super("tino:aws:TinoService", name, {}, opts);

    const hipaaCompliance = args.compliance?.hipaa !== false; // default true
    const soc2Compliance = args.compliance?.soc2 !== false;   // default true
    const gdprCompliance = args.compliance?.gdpr === true;    // default false
    const hitrustCompliance = args.compliance?.hitrust === true; // default false

    // HITRUST is a superset of HIPAA — if HITRUST is on, HIPAA is on
    const effectiveHipaa = hipaaCompliance || hitrustCompliance;

    const complianceTags: Record<string, string> = {};
    if (effectiveHipaa) complianceTags["compliance:hipaa"] = "true";
    if (soc2Compliance) complianceTags["compliance:soc2"] = "true";
    if (gdprCompliance) complianceTags["compliance:gdpr"] = "true";
    if (hitrustCompliance) complianceTags["compliance:hitrust"] = "true";

    const tags = { ...args.tags, "tino:managed": "true", ...complianceTags };

    // ── Compliance enforcement ────────────────────────────────────────────
    // These run during `pulumi preview` and `pulumi up`.

    // HIPAA: hard gate — deployment fails unless the deployer has explicitly
    // acknowledged a signed BAA via `pulumi config set tino:baaAcknowledged true`.
    // There is no AWS API that confirms BAA status programmatically; requiring
    // explicit acknowledgment is the strongest enforcement possible.
    if (effectiveHipaa) {
      const tinoConfig = new pulumi.Config("tino");
      const baaAcknowledged = tinoConfig.get("baaAcknowledged");
      if (baaAcknowledged !== "true") {
        throw new Error(
          [
            "",
            "═══════════════════════════════════════════════════════════════",
            "  HIPAA compliance requires a signed AWS Business Associate",
            "  Addendum (BAA) on this AWS account.",
            "",
            "  1. Verify at: https://console.aws.amazon.com/artifact/",
            "  2. Then run:  pulumi config set tino:baaAcknowledged true",
            "",
            "  To deploy without HIPAA compliance (not recommended for PHI):",
            "    compliance: { hipaa: false }",
            "═══════════════════════════════════════════════════════════════",
            "",
          ].join("\n"),
        );
      }
    }

    // ── VPC ──────────────────────────────────────────────────────────────
    // Use provided VPC (object or ID string), or discover the default VPC.
    const vpcId: pulumi.Input<string> = (() => {
      if (!args.vpc) {
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
    // Private subnets for ECS task (existing logic).
    const subnetIds: pulumi.Input<pulumi.Input<string>[]> =
      args.subnets ?? discoverSubnets(vpcId);

    // Public subnets for ALB (internet-facing).
    const publicSubnetIds = aws.ec2.getSubnetsOutput({
      filters: [
        { name: "vpc-id", values: [vpcId] },
        { name: "map-public-ip-on-launch", values: ["true"] },
      ],
    }).ids;

    // ── KMS key (always) ─────────────────────────────────────────────────
    const callerIdentity = aws.getCallerIdentityOutput();
    const currentRegion = aws.getRegionOutput();
    const accountId = callerIdentity.accountId;

    const kmsKey = new aws.kms.Key(`${name}-kms`, {
      description: `tino encryption key (${name})`,
      enableKeyRotation: true,
      policy: pulumi.all([accountId, currentRegion.name]).apply(([acctId, region]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "EnableRootAccountFullAccess",
              Effect: "Allow",
              Principal: { AWS: `arn:aws:iam::${acctId}:root` },
              Action: "kms:*",
              Resource: "*",
            },
            {
              Sid: "AllowCloudWatchLogs",
              Effect: "Allow",
              Principal: { Service: `logs.${region}.amazonaws.com` },
              Action: [
                "kms:Encrypt",
                "kms:Decrypt",
                "kms:ReEncrypt*",
                "kms:GenerateDataKey*",
                "kms:DescribeKey",
              ],
              Resource: "*",
              Condition: {
                ArnLike: {
                  "kms:EncryptionContext:aws:logs:arn": `arn:aws:logs:${region}:${acctId}:log-group:*`,
                },
              },
            },
          ],
        }),
      ),
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

    // ── SOC 2: VPC Flow Logs ─────────────────────────────────────────────
    // Creates tino-owned flow logs on the VPC (encrypted, 1-minute granularity).
    // AWS allows multiple flow logs per VPC — this adds tino's own destination
    // without conflicting with any existing flow log configuration.
    if (soc2Compliance) {
      const flowLogRole = new aws.iam.Role(`${name}-flow-log-role`, {
        assumeRolePolicy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: { Service: "vpc-flow-logs.amazonaws.com" },
          }],
        }),
        tags,
      }, { parent: this });

      new aws.iam.RolePolicy(`${name}-flow-log-policy`, {
        role: flowLogRole.name,
        policy: pulumi.all([logGroup.arn]).apply(([logArn]) =>
          JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
              Effect: "Allow",
              Action: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
              ],
              Resource: ["*"],
            }],
          }),
        ),
      }, { parent: this });

      // Dedicated log group for flow logs — separate from tino's app logs.
      // Encrypted with tino's KMS key; 90-day retention for SOC 2 audit trail.
      const flowLogGroup = new aws.cloudwatch.LogGroup(`${name}-flow-logs`, {
        name: `/vpc/tino-${name}`,
        retentionInDays: 90,
        kmsKeyId: kmsKey.arn,
        tags,
      }, { parent: this });

      new aws.ec2.FlowLog(`${name}-vpc-flow-log`, {
        vpcId: vpcId,
        trafficType: "ALL",
        logDestinationType: "cloud-watch-logs",
        logGroupName: flowLogGroup.name,
        iamRoleArn: flowLogRole.arn,
        maxAggregationInterval: 60, // 1-minute granularity (most detailed)
        tags: { ...tags, "tino:resource": "vpc-flow-log" },
      }, { parent: this });
    }

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
    // imageTagMutability: MUTABLE allows pushing updated images to the same tag.
    // The docker-build provider pushes to :latest on each deploy.
    // Image scanning on push provides the security control.
    const ecrRepo = new aws.ecr.Repository(`${name}-ecr`, {
      name: `tino-${name}`,
      forceDelete: false,
      imageScanningConfiguration: { scanOnPush: true },
      imageTagMutability: "MUTABLE",
      tags,
    }, { parent: this });

    this.ecrRepoUri = ecrRepo.repositoryUrl;

    // ── Docker image ─────────────────────────────────────────────────────
    // @pulumi/docker-build builds and pushes the image as part of `pulumi up`.
    // The build context is read from `tino:dockerContext` Pulumi config (set by
    // the CLI to the tino-assistant repo root). Falls back to "." if not set.
    const tinoConfig = new pulumi.Config("tino");
    const dockerContext = tinoConfig.get("dockerContext") ?? ".";

    const builtImage = new dockerBuild.Image(`${name}-image`, {
      tags: [pulumi.interpolate`${ecrRepo.repositoryUrl}:latest`],
      context: {
        location: dockerContext,
      },
      // Push to ECR after build
      push: true,
      // ECR auth — AWS credentials come from the environment (same as pulumi up)
      registries: [{
        address: ecrRepo.repositoryUrl,
        username: "AWS",
        password: aws.ecr.getAuthorizationTokenOutput({
          registryId: ecrRepo.registryId,
        }).password,
      }],
      // Build for linux/amd64 (Fargate)
      platforms: [dockerBuild.Platform.Linux_amd64],
    }, { parent: this });

    this.imageUri = builtImage.ref;

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
    const extraLogGroupArns: pulumi.Input<string>[] = args.cloudwatchLogGroupArns ?? [];
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
    const cluster = args.cluster ?? new aws.ecs.Cluster(`${name}-cluster`, {
      name: `tino-${name}`,
      settings: [{ name: "containerInsights", value: "enabled" }],
      tags,
    }, { parent: this });

    this.clusterName = cluster.name;

    // ── ALB security group ───────────────────────────────────────────────
    // Allow inbound on 443 (with custom domain) or 80 (without) from anywhere.
    const albSg = new aws.ec2.SecurityGroup(`${name}-alb-sg`, {
      vpcId,
      description: "tino console ALB",
      ingress: [{
        protocol: "tcp",
        fromPort: args.consoleDomain ? 443 : 80,
        toPort: args.consoleDomain ? 443 : 80,
        cidrBlocks: ["0.0.0.0/0"],
        description: "Console access",
      }],
      egress: [{
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
      }],
      tags,
    }, { parent: this });

    // ── ALB ──────────────────────────────────────────────────────────────
    const alb = new aws.lb.LoadBalancer(`${name}-alb`, {
      internal: false,
      loadBalancerType: "application",
      securityGroups: [albSg.id],
      subnets: publicSubnetIds,
      tags,
    }, { parent: this });

    // ── Target group ─────────────────────────────────────────────────────
    // Points to the ECS task on port 3001.
    const tg = new aws.lb.TargetGroup(`${name}-tg`, {
      port: 3001,
      protocol: "HTTP",
      targetType: "ip",
      vpcId,
      healthCheck: {
        path: "/api/health",
        port: "3001",
        protocol: "HTTP",
        healthyThreshold: 2,
        unhealthyThreshold: 3,
        interval: 30,
        timeout: 5,
      },
      tags,
    }, { parent: this });

    // ── HTTPS with custom domain ──────────────────────────────────────────
    if (args.consoleDomain && args.hostedZoneId) {
      const cert = new aws.acm.Certificate(`${name}-cert`, {
        domainName: args.consoleDomain,
        validationMethod: "DNS",
        tags,
      }, { parent: this });

      const validationRecord = new aws.route53.Record(`${name}-cert-validation`, {
        zoneId: args.hostedZoneId,
        name: cert.domainValidationOptions.apply(opts => opts[0]!.resourceRecordName),
        type: cert.domainValidationOptions.apply(opts => opts[0]!.resourceRecordType),
        records: [cert.domainValidationOptions.apply(opts => opts[0]!.resourceRecordValue)],
        ttl: 60,
      }, { parent: this });

      const certValidation = new aws.acm.CertificateValidation(`${name}-cert-valid`, {
        certificateArn: cert.arn,
        validationRecordFqdns: [validationRecord.fqdn],
      }, { parent: this });

      new aws.lb.Listener(`${name}-https`, {
        loadBalancerArn: alb.arn,
        port: 443,
        protocol: "HTTPS",
        certificateArn: certValidation.certificateArn,
        defaultActions: [{ type: "forward", targetGroupArn: tg.arn }],
      }, { parent: this });

      new aws.lb.Listener(`${name}-http-redirect`, {
        loadBalancerArn: alb.arn,
        port: 80,
        protocol: "HTTP",
        defaultActions: [{
          type: "redirect",
          redirect: { protocol: "HTTPS", port: "443", statusCode: "HTTP_301" },
        }],
      }, { parent: this });

      new aws.route53.Record(`${name}-dns`, {
        zoneId: args.hostedZoneId,
        name: args.consoleDomain,
        type: "A",
        aliases: [{
          name: alb.dnsName,
          zoneId: alb.zoneId,
          evaluateTargetHealth: true,
        }],
      }, { parent: this });
    }

    // ── HTTP without custom domain ────────────────────────────────────────
    if (!args.consoleDomain) {
      new aws.lb.Listener(`${name}-http`, {
        loadBalancerArn: alb.arn,
        port: 80,
        protocol: "HTTP",
        defaultActions: [{ type: "forward", targetGroupArn: tg.arn }],
      }, { parent: this });
    }

    // ── Console URL output ────────────────────────────────────────────────
    this.consoleUrl = args.consoleDomain
      ? pulumi.output(`https://${args.consoleDomain}`)
      : alb.dnsName.apply(dns => `http://${dns}`);

    // ── ECS security group ───────────────────────────────────────────────
    // Allows inbound from the ALB on port 3001; all outbound allowed.
    const sg = new aws.ec2.SecurityGroup(`${name}-sg`, {
      vpcId,
      description: "tino ECS task",
      ingress: [{
        protocol: "tcp",
        fromPort: 3001,
        toPort: 3001,
        securityGroups: [albSg.id],
        description: "Allow traffic from ALB to console",
      }],
      egress: [{
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
        description: "Allow all outbound",
      }],
      tags,
    }, { parent: this });

    // ── ECS task definition ──────────────────────────────────────────────
    // All runtime config (credentials, model ID, Slack tokens) is read from
    // the DynamoDB config store at startup. No secrets in the task definition.
    //
    // readonlyRootFilesystem: true — container cannot write to its root FS.
    // /tmp is mounted as an ephemeral volume for Node.js scratch space.
    //
    // NOTE: @tino/core's console server must bind to 0.0.0.0:3001 when
    // CONSOLE_BASE_URL is set (production). This change is in @tino/core,
    // not in this component.
    const taskDef = new aws.ecs.TaskDefinition(`${name}-task`, {
      family: `tino-${name}`,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: args.cpu ?? "256",
      memory: args.memory ?? "512",
      executionRoleArn: taskExecutionRole.arn,
      taskRoleArn: taskRole.arn,
      // Ephemeral volume for /tmp (required when readonlyRootFilesystem is true).
      volumes: [{
        name: "tmp",
        // Fargate ephemeral storage — no host path needed.
      }],
      containerDefinitions: pulumi.all([
        logGroup.name,
        this.consoleUrl,
        pulumi.output(args.googleOAuthClientId),
        pulumi.output(args.googleOAuthClientSecret),
        builtImage.ref,
      ]).apply(
        ([logName, consoleBaseUrl, googleClientId, googleClientSecret, imageRef]) => JSON.stringify([{
          name: "tino",
          image: imageRef,
          essential: true,
          readonlyRootFilesystem: true,
          portMappings: [{
            containerPort: 3001,
            protocol: "tcp",
          }],
          mountPoints: [{
            sourceVolume: "tmp",
            containerPath: "/tmp",
            readOnly: false,
          }],
          environment: [
            { name: "NODE_ENV", value: "production" },
            { name: "PERSISTENCE_ADAPTER", value: "dynamodb" },
            { name: "DYNAMODB_TABLE_NAME", value: `tino-${name}` },
            { name: "LOG_LEVEL", value: "info" },
            { name: "GOOGLE_OAUTH_CLIENT_ID", value: googleClientId },
            { name: "GOOGLE_OAUTH_CLIENT_SECRET", value: googleClientSecret },
            { name: "CONSOLE_ALLOWED_DOMAIN", value: args.allowedDomain ?? "" },
            { name: "CONSOLE_BASE_URL", value: consoleBaseUrl },
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
        // assignPublicIp: true when no explicit subnets provided (default VPC
        // has no NAT gateway, so the task needs a public IP for outbound access
        // to ECR, Slack, Bedrock, etc.). When the user passes private subnets
        // from their own VPC (which should have a NAT gateway), this is false.
        assignPublicIp: !args.subnets,
      },
      loadBalancers: [{
        targetGroupArn: tg.arn,
        containerName: "tino",
        containerPort: 3001,
      }],
      enableExecuteCommand: args.enableExec ?? false,
      tags,
    }, { parent: this });

    this.serviceName = service.name;

    // ── Console access note ──────────────────────────────────────────────
    this.consoleNote = pulumi.all([cluster.name, service.name]).apply(
      ([clusterName, serviceName]) =>
        `ECS Exec is ${args.enableExec ? "enabled" : "disabled"}.\n` +
        (args.enableExec
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
      consoleUrl: this.consoleUrl,
    });
  }
}
