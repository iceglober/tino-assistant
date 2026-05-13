<p align="center">
  <img src="assets/tino-logo.png" alt="tino" width="120">
</p>

# tino

Personal Claude agent running locally in Slack DM.

## Setup

```sh
git clone <repo>
cd tino
nvm use          # picks up .nvmrc → Node 22
cp .env.example .env
# fill in .env with your tokens and credentials
pnpm install
pnpm dev
```

## Development

| Command | What it does |
|---|---|
| `pnpm dev` | Start with `tsx watch` — restarts on file changes |
| `pnpm test` | Run vitest test suite once |
| `pnpm typecheck` | TypeScript type-check (no emit) |

## Config console

When tino is running, a minimal web console is available at **http://localhost:3001** (localhost only — not exposed externally).

Use it to:
- Add GitHub repos to the allowlist (`github.repos`)
- Set the default GitHub repo (`github.default_repo`)
- Add CloudWatch log groups (`cloudwatch.log_groups`)
- View all runtime config and health status

Config changes take effect on the next tool call — no restart needed.

## Deployment (ECS Fargate)

### Prerequisites

- AWS CLI configured (`aws configure` or `AWS_PROFILE` set)
- Docker installed and running
- CDK bootstrapped once per account/region: `cd infra && npx cdk bootstrap`

### First deploy

```sh
# 1. Install CDK dependencies
cd infra && pnpm install

# 2. Deploy the infrastructure (VPC, ECR, EFS, ECS cluster + service)
pnpm run deploy
cd ..

# 3. Set secrets in SSM Parameter Store
#    Option A: bulk setup from a JSON file (recommended)
cp secrets.example.json secrets.json
# fill in secrets.json with your actual values
chmod +x scripts/setup-secrets.sh
./scripts/setup-secrets.sh secrets.json

#    Option B: one command per secret
aws ssm put-parameter --name /tino/SLACK_BOT_TOKEN        --value "xoxb-..."  --type SecureString
aws ssm put-parameter --name /tino/SLACK_APP_TOKEN        --value "xapp-..."  --type SecureString
aws ssm put-parameter --name /tino/SLACK_USER_TOKEN       --value "xoxp-..."  --type SecureString
aws ssm put-parameter --name /tino/ALLOWED_SLACK_USER_ID  --value "U..."      --type SecureString
aws ssm put-parameter --name /tino/GITHUB_TOKEN           --value "ghp_..."   --type SecureString
aws ssm put-parameter --name /tino/GOOGLE_OAUTH_CLIENT_ID     --value "..."   --type SecureString
aws ssm put-parameter --name /tino/GOOGLE_OAUTH_CLIENT_SECRET --value "..."   --type SecureString
aws ssm put-parameter --name /tino/GOOGLE_OAUTH_REFRESH_TOKEN --value "..."   --type SecureString
aws ssm put-parameter --name /tino/BEDROCK_MODEL_ID       --value "global.anthropic.claude-sonnet-4-6" --type SecureString

# 4. Build and push the container image, then force a new ECS deployment
pnpm run deploy:app
```

### Deploy code changes

```sh
pnpm run deploy:app
```

This builds the Docker image, pushes it to ECR, and forces a new ECS task deployment. The new task starts in ~30 seconds.

### View logs

```sh
aws logs tail /ecs/tino --follow
```

### Destroy infrastructure

```sh
cd infra && pnpm run destroy
```

ECR images and EFS data (the SQLite database) are **retained** after destroy — `RemovalPolicy.RETAIN` is set on both. Delete them manually if needed.

## Troubleshooting

_(Phase 2 will add "bot doesn't respond" debugging steps here.)_

---

See [plans/tino.md](plans/tino.md) for the full buildout plan.
