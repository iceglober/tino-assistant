<p align="center">
  <img src="assets/tino-logo.png" alt="tino" width="120">
</p>

# tino

A Claude agent that lives in your Slack DM, runs in your AWS account, and remembers what you ask it. Backed by Bedrock for inference and DynamoDB for state. HIPAA-aware: encryption-at-rest on all stateful resources, an audit trail for every tool call, and a hard BAA gate before deploys.

## Two installation paths

Pick the one that fits where you are.

### A. Standalone — `tino init` (recommended)

The fastest path. Runs an interactive setup that asks for your AWS profile, Slack admin user, Google OAuth credentials, and HIPAA BAA status, then writes a Pulumi project to `./infra-tino/` and deploys it.

```sh
git clone <repo> tino && cd tino
pnpm install
pnpm --filter @tino/cli build
node packages/cli/dist/index.js init
```

You end up with:
- a Pulumi stack you own,
- the tino service running on Fargate behind an ALB,
- a config console at the printed URL,
- a `tino.deploy.json` capturing the choices you made.

See [`docs/deployment.md`](docs/deployment.md) for the full walkthrough.

### B. Library — drop into an existing Pulumi project

If you already have a Pulumi project (your VPC, your cluster), import the component:

```ts
import { TinoService } from "@tino/aws";

const tino = new TinoService("tino", {
  vpc: network.vpcId,
  subnets: network.privateSubnetIds,
  cluster: existingCluster,
  googleOAuthClientId: config.require("googleOAuthClientId"),
  googleOAuthClientSecret: config.requireSecret("googleOAuthClientSecret"),
  allowedDomain: "example.com",
  // Optional HTTPS (both required together):
  consoleDomain: "tino.example.com",
  hostedZoneId: "Z0123456789ABCDEFGHIJ",
});
```

The component provisions DynamoDB, KMS, ECR, the ECS task, the ALB, and (when `consoleDomain` is set) ACM + Route53. It expects you to bring the VPC.

## Documentation

- [`docs/deployment.md`](docs/deployment.md) — step-by-step deploy
- [`docs/console.md`](docs/console.md) — using the web console
- [`docs/architecture.md`](docs/architecture.md) — how tino is put together
- [`docs/security.md`](docs/security.md) — what's enforced, and where
- [`docs/migration.md`](docs/migration.md) — renaming `tino-tino` → `tino`, switching adapters
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — local dev, tests, adding tools

## Local development

```sh
nvm use          # picks up .nvmrc → Node 22
cp .env.example .env
# fill in .env with your tokens
pnpm install
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm dev` | Start core with `tsx watch` — restarts on file changes |
| `pnpm test` | Run vitest across the workspace |
| `pnpm typecheck` | TypeScript check (no emit) |

The local dev mode uses SQLite (`./tino.db`) and an in-memory audit logger — durable persistence is DynamoDB-only. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev loop in more depth.

## Config console

When tino is running, the console is at **`http://localhost:3001`** in dev or `https://<consoleDomain>` in production. It manages Slack tokens, Google OAuth, the Bedrock model ID, capability connections (GitHub, Linear, CloudWatch), and surfaces a HIPAA compliance dashboard.

Config changes take effect on the next tool call — no restart needed for capability changes; Slack reconnections happen via the console's "reconnect" button.

## Plan history

The current buildout plan lives at [`docs/plans/v2_1/main.md`](docs/plans/v2_1/main.md).
