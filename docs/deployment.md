# deployment

Step-by-step guide for deploying tino into your own AWS account.

This is the standalone path. For the "drop into an existing Pulumi project" path see [`architecture.md`](architecture.md) and the `TinoService` constructor in [`packages/aws/src/pulumi/tino-service.ts`](../packages/aws/src/pulumi/tino-service.ts).

## prerequisites

Before you start:

- AWS account with admin (or near-admin) credentials. The deploy creates KMS keys, IAM roles, an ECS cluster, an ALB, ECR, DynamoDB, and CloudWatch resources.
- AWS CLI configured (`aws configure` or `AWS_PROFILE` set) — the AWS SDK's default credential chain must resolve.
- Pulumi installed (`brew install pulumi/tap/pulumi`).
- Docker installed and running — the deploy builds the image locally with `@pulumi/docker-build` before pushing to ECR.
- Node 22 (`nvm use` in the repo root picks it up from `.nvmrc`).
- pnpm installed (`npm install -g pnpm`).

For HIPAA: a signed [AWS Business Associate Addendum](https://console.aws.amazon.com/artifact/) on the account. The Pulumi component throws on `pulumi up` until you run `pulumi config set tino:baaAcknowledged true` — see `packages/aws/src/pulumi/tino-service.ts:262`.

## one-time setup

```sh
git clone <repo> tino && cd tino
pnpm install
pnpm --filter @tino/cli build
```

## interactive setup with `tino init`

```sh
node packages/cli/dist/index.js init
```

The wizard walks through six steps:

1. **Compliance frameworks** — pick HIPAA (default). Records the choice in `tino.deploy.json`.
2. **BAA acknowledgement** — confirms you've signed the AWS BAA. Without this, `pulumi up` will throw.
3. **Console authentication** — Google OAuth client ID + secret. The redirect URI must match what you register in the GCP console (see "Google OAuth" below).
4. **Infrastructure** — standalone (default, generates `./infra-tino/`) or "add to an existing Pulumi project" (generates `<your-infra>/tino.ts`).
5. **Region** — `us-east-1` is the default for broadest Bedrock model coverage.
6. **Review** — prints `tino.deploy.json` and asks for confirmation.

Output: a Pulumi project at `./infra-tino/` (or wherever you chose) with `index.ts`, `Pulumi.yaml`, and `package.json` already wired up against the local `@tino/aws` and `@tino/core` packages via `file:` links.

## the actual deploy

```sh
cd infra-tino
pulumi up
```

First deploy takes 5–10 minutes (creating KMS, DynamoDB, ECR, the ECS cluster, the ALB). The image is built locally and pushed to ECR as part of the Pulumi run.

When it finishes, Pulumi prints `consoleUrl` — that's where you go to configure the rest.

## Google OAuth

The console is protected by Google Sign-In. You need an OAuth 2.0 client of type "Web application" in the [GCP console](https://console.cloud.google.com/apis/credentials).

**Authorized redirect URIs** must match the protocol the console runs on:

| Mode | Redirect URI |
|---|---|
| Local dev | `http://localhost:3001/api/auth/callback/google` |
| Deployed, no `consoleDomain` | `http://<alb-dns>/api/auth/callback/google` |
| Deployed, with `consoleDomain` | `https://<consoleDomain>/api/auth/callback/google` |

If you set `consoleDomain` after the first deploy, **update the GCP redirect URI** before users hit the new URL — Google will reject the callback otherwise.

For the no-`consoleDomain` case the ALB DNS name is auto-generated (`tino-alb-1234567890.us-east-1.elb.amazonaws.com`-shaped), so the redirect URI changes if you destroy and re-create the stack.

## HTTPS with a custom domain

By default the console runs on HTTP at the ALB's auto-generated DNS name. Browsers show a "Not Secure" warning, OAuth tokens travel in plaintext, and the console itself shows a banner telling you about it.

To deploy with HTTPS:

1. Create a public Route53 hosted zone for your apex domain (e.g. `example.com`). Note the zone ID.
2. Edit `infra-tino/index.ts`:

   ```ts
   const tino = new TinoService("tino", {
     // …existing args…
     consoleDomain: "tino.example.com",
     hostedZoneId: "Z0123456789ABCDEFGHIJ",
   });
   ```

3. Run `pulumi up`. The component creates an ACM certificate, validates it via DNS, attaches it to a 443 listener on the ALB, and adds a Route53 alias record pointing at the ALB.
4. **Update the Google OAuth redirect URI** to `https://tino.example.com/api/auth/callback/google`.

Both `consoleDomain` and `hostedZoneId` are required together — the component throws if you pass one without the other (see `tino-service.ts` validation block).

## deploying code changes

```sh
cd infra-tino
pulumi up
```

The `@pulumi/docker-build` provider rebuilds the image, pushes it to ECR, and the ECS service picks up the new digest. New task starts in ~30 seconds.

## viewing logs

```sh
aws logs tail /ecs/tino --follow
```

(`tino` is the resource prefix — see [`migration.md`](migration.md) if you're on an older `tino-tino` deployment.)

## audit retention

Audit log retention defaults to 90 days. Override via `auditRetentionDays` on `TinoServiceArgs` — the value is passed to the container as `AUDIT_RETENTION_DAYS` and used by the DynamoDB audit logger to set TTL on each entry (`packages/aws/src/audit/dynamo.ts:53`).

## destroying the stack

```sh
cd infra-tino
pulumi destroy
```

The DynamoDB table has `deletionProtectionEnabled: true` (`tino-service.ts:387`) — `pulumi destroy` will fail until you disable deletion protection in the AWS console. This is intentional: the table holds your audit trail and runtime config.

## troubleshooting

- **`pulumi up` throws "HIPAA compliance requires a signed BAA"** — run `pulumi config set tino:baaAcknowledged true` after verifying the BAA in AWS Artifact.
- **Google sign-in returns `redirect_uri_mismatch`** — the redirect URI registered in GCP doesn't match the protocol/domain. See "Google OAuth" above.
- **ECS task keeps stopping** — `aws logs tail /ecs/tino` will show the underlying error. Most often: missing `DYNAMODB_TABLE_NAME` env var (only happens if you've manually edited the task definition) or a `ResourceNotFoundException` for the table (which means the table name doesn't match the env var — see `migration.md`).
- **"Not Secure" banner in the console** — set `consoleDomain` and re-deploy. See "HTTPS with a custom domain" above.
