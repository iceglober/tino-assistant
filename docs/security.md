# security

Security and compliance model for tino. Every claim here points at the file/line that enforces it.

## summary

- **Encryption at rest:** every stateful AWS resource — DynamoDB, CloudWatch Logs, SNS — is encrypted with a customer-managed KMS key the component provisions. Key rotation is enabled.
- **Encryption in transit:** HTTPS via ACM when `consoleDomain` is set. HTTP without (with a console banner warning the operator). Slack and AWS SDK calls are TLS by default.
- **Audit trail:** every tool call, config change, login, capability toggle, scheduled task, restart, and injection-suspicion event is logged to a TTL-backed DynamoDB table.
- **Access control:** Google OAuth on the console (domain-restricted). Slack DMs filtered to a single admin user ID. IAM least-privilege on the task role.
- **HIPAA gate:** `pulumi up` refuses to deploy until the operator confirms a signed BAA on the AWS account.

## what's enforced automatically

| Control | Where |
|---|---|
| KMS CMK with rotation | `packages/aws/src/pulumi/tino-service.ts:317` |
| DynamoDB encryption-at-rest with the CMK | `packages/aws/src/pulumi/tino-service.ts:386` |
| DynamoDB point-in-time recovery | `packages/aws/src/pulumi/tino-service.ts:384` |
| DynamoDB deletion protection | `packages/aws/src/pulumi/tino-service.ts:387` |
| CloudWatch Logs encryption-at-rest with the CMK | `packages/aws/src/pulumi/tino-service.ts:400` |
| SNS topic encryption with the CMK | `packages/aws/src/pulumi/tino-service.ts:466` |
| ECR image scan-on-push | `packages/aws/src/pulumi/tino-service.ts:504` |
| Container read-only root filesystem | `packages/aws/src/pulumi/tino-service.ts:861` |
| ECS Exec off by default | `packages/aws/src/pulumi/tino-service.ts:919` |
| Task role scoped to the DynamoDB table ARN | `packages/aws/src/pulumi/tino-service.ts:614` |
| Bedrock IAM region-scoped under GDPR | `packages/aws/src/pulumi/tino-service.ts:605` |
| HIPAA BAA gate | `packages/aws/src/pulumi/tino-service.ts:262` |
| VPC Flow Logs (SOC 2 CC6.1) | `packages/aws/src/pulumi/tino-service.ts:452` |
| Security event metric filter + SNS alarm | `packages/aws/src/pulumi/tino-service.ts:474` |
| Container Insights for audit depth | `packages/aws/src/pulumi/tino-service.ts:676` |
| Audit logger TTL (default 90 days) | `packages/aws/src/audit/dynamo.ts:22` |
| Audit entries store parameter KEYS only, never values | `packages/core/src/audit/logger.ts:29` |
| Logger never emits raw OAuth tokens | callers in `packages/core/src/server/` |

## what the operator must do

These cannot be enforced in code; the deploy pipeline reminds you:

- **Sign the AWS BAA** if processing PHI. Verify in [AWS Artifact](https://console.aws.amazon.com/artifact/), then `pulumi config set tino:baaAcknowledged true`.
- **No BAA available from Slack on standard plans.** If you handle PHI in Slack, you need an Enterprise Grid contract that includes a BAA. The compliance dashboard reports `slack: no-baa` honestly.
- **Restrict the Google OAuth client** to your `allowedDomain`. The console enforces it server-side, but the GCP-side restriction is your defence-in-depth.
- **Subscribe a human to the SNS topic.** The component creates the topic but does not manage subscriptions — pick email, PagerDuty, etc. The topic ARN is exposed as `alertTopicArn`.

## audit logging

Every event the system considers material is recorded. The action vocabulary is fixed — see [`packages/core/src/audit/logger.ts`](../packages/core/src/audit/logger.ts):

- `tool_call` — every LLM-initiated tool invocation (success, error, or denied).
- `config_change` — any write to the config store.
- `login` — Google OAuth callback success.
- `capability_toggle` — capability enabled/disabled via the console.
- `task_scheduled`, `task_executed` — scheduler events.
- `injection_suspected` — prompt injection heuristics tripped.
- `user_deprovisioned` — admin removed a user.
- `admin_restart` — admin triggered a process restart from the console.

Each entry captures: `timestamp`, `userId`, `action`, optional `toolName`/`capabilityInstanceId`, optional `inputKeys` (parameter **keys** only — never values), `durationMs`, `status` (`success`/`error`/`denied`), optional `errorMessage`.

Backends:
- Local dev → in-memory (entries lost on restart). Acceptable for SQLite mode.
- Production → DynamoDB with TTL. Default retention 90 days; override via `auditRetentionDays` on `TinoServiceArgs`.

The audit table is queryable from the compliance dashboard (`GET /api/compliance` returns `entryCount`, `lastEntryAt`, `retentionDays`).

## injection defence

Tino runs a tool-using LLM. Prompt injection is real; the defence layers are:

1. **Tool-call allowlist per capability.** A user without GitHub credentials cannot have GitHub tools registered. The registry never instantiates a tool whose capability is missing config.
2. **Resource scoping at the IAM layer.** The CloudWatch tool can only query log groups in `cloudwatchLogGroupArns`; even a successful injection cannot reach unrelated log groups.
3. **Audit log + alarm.** When the agent loop detects a suspicious tool input (path traversal, repeated denied calls, etc.) it logs `injection_suspected`. The CloudWatch metric filter on `tino-service.ts:474` raises an alarm at >5 such events in 15 minutes.

## network posture

- ALB is internet-facing because the console is human-accessed. Listener is 443 (with `consoleDomain`) or 80 (without). Port 80 redirects to 443 when both are configured.
- ECS task is in private subnets when you bring your own VPC; the ALB security group is the only ingress. Without a custom VPC, the task uses the default VPC's subnets and gets a public IP for outbound to ECR/Slack/Bedrock.
- VPC Flow Logs are enabled by default (SOC 2 CC6.1) and stored in a CloudWatch log group encrypted with the component's CMK.

## what tino does NOT do

Be honest about gaps:

- **No WAF.** The ALB is not behind AWS WAF. Add one yourself if your threat model requires it.
- **No Shield Advanced.** Standard Shield is on by default; Advanced is not provisioned.
- **No GuardDuty enforcement.** The component does not enable or require GuardDuty on the account.
- **No Config rules.** AWS Config is not configured.
- **No automated key rotation policy beyond the KMS default.** Rotation is enabled on the CMK; older key versions remain accessible per the AWS default lifecycle.
- **No data classification or DLP.** Audit `inputKeys` are key NAMES only, not a content scanner. If a tool's parameter values contain PHI, that PHI lives in CloudWatch container logs unless the tool implementation explicitly strips it.

If your environment requires any of the above, layer them on at the account level; the component does not conflict.

## reporting incidents

[`docs/incident-response-template.md`](incident-response-template.md) is a fill-in-the-blanks template for HIPAA breach notifications and operational incidents.
