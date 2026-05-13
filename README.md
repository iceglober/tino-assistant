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

# 3. Set secrets in SSM Parameter Store (one command per secret)
aws ssm put-parameter --name /tino/SLACK_BOT_TOKEN        --value "xoxb-..."  --type SecureString
aws ssm put-parameter --name /tino/SLACK_APP_TOKEN        --value "xapp-..."  --type SecureString
aws ssm put-parameter --name /tino/SLACK_USER_TOKEN       --value "xoxp-..."  --type SecureString
aws ssm put-parameter --name /tino/ALLOWED_SLACK_USER_ID  --value "U..."      --type SecureString
aws ssm put-parameter --name /tino/GITHUB_TOKEN           --value "ghp_..."   --type SecureString
aws ssm put-parameter --name /tino/GITHUB_DEFAULT_REPO    --value "owner/repo" --type SecureString
aws ssm put-parameter --name /tino/GOOGLE_OAUTH_CLIENT_ID     --value "..."   --type SecureString
aws ssm put-parameter --name /tino/GOOGLE_OAUTH_CLIENT_SECRET --value "..."   --type SecureString
aws ssm put-parameter --name /tino/GOOGLE_OAUTH_REFRESH_TOKEN --value "..."   --type SecureString
aws ssm put-parameter --name /tino/BEDROCK_MODEL_ID       --value "us.anthropic.claude-sonnet-4-5-20251101-v1:0" --type SecureString

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
