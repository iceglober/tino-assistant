# architecture

How tino is put together. Read this before changing anything load-bearing.

## principles

1. **The console is the only configuration interface.** No env vars for runtime config; every credential, model ID, and capability setting lives in the config store and is read live.
2. **Every config change takes effect immediately.** Hot-reload is the default; restart is the failure mode.
3. **One process does everything.** The Slack bot, the agent runtime, the scheduler, and the console all run in a single Node process. Less coordination, fewer failure modes.
4. **Security is enforced in code, not in policy.** Every claim in the README points at a file/line that proves it.

## packages

The repo is a pnpm workspace with three packages:

### `@tino/core` — [`packages/core/`](../packages/core)

The runtime. Slack handlers, the agent loop, persistence interfaces, the console server, the SPA, the scheduler, the capability registry. Has no AWS-specific code outside dynamic imports — `@tino/aws` is loaded only when `PERSISTENCE_ADAPTER=dynamodb`.

Top-level layout:

- `src/index.ts` — process entry; wires persistence, registry, Slack, scheduler, console.
- `src/agent/` — Claude/Bedrock client, agent loop, history store interface.
- `src/audit/` — audit logger interface (`logger.ts`) + in-memory implementation (`memory.ts`).
- `src/capabilities/` — capability schema, registry, migration from env vars, per-capability config (GitHub, Linear, Slack, etc.).
- `src/console-app/` — Vite + React SPA. Builds to `dist/console-app/`; served by the Hono server.
- `src/persistence/` — abstract stores (`HistoryStore`, `TaskStore`, `PreferencesStore`, `ConfigStore`) + SQLite implementations + the `createPersistence` factory.
- `src/scheduler/` — cron-style task runner.
- `src/server/` — Hono routes (auth, config, capabilities, compliance, health, reload, admin, users).
- `src/slack/` — Bolt app construction, DM handler, proactive DM helper.
- `src/tools/` — concrete tool implementations (CloudWatch, GitHub, Google, Linear, Slack, preferences, tasks).

### `@tino/aws` — [`packages/aws/`](../packages/aws)

AWS-specific implementations. Imported lazily by core when running on DynamoDB; imported directly by user Pulumi projects via the `TinoService` component.

- `src/pulumi/tino-service.ts` — the `TinoService` Pulumi component. Provisions VPC config, KMS, DynamoDB, ECR, ECS cluster + task + service, ALB + target group, IAM, CloudWatch logs, optional ACM/Route53 for HTTPS, optional VPC Flow Logs for SOC 2. ~1000 lines, intentionally one file because the resource graph is the unit of comprehension.
- `src/persistence/dynamo/` — DynamoDB-backed implementations of every store (history, tasks, preferences, config) plus the table client. Single-table design (`pk` + `sk` + `gsi1`).
- `src/audit/dynamo.ts` — DynamoDB-backed audit logger. TTL-based retention, default 90 days.
- `src/encryption/` — KMS helpers.

Exports:
- `@tino/aws` — re-exports `TinoService`.
- `@tino/aws/persistence` — `createDynamoPersistence(env, logger)` for `@tino/core`'s factory.
- `@tino/aws/audit` — `createDynamoAuditLogger(table, retentionSeconds)`.
- `@tino/aws/pulumi` — Pulumi-only re-exports.
- `@tino/aws/encryption` — encryption helpers.

### `@tino/cli` — [`packages/cli/`](../packages/cli)

The `tino init` and `tino deploy` wizards. Generates Pulumi projects, walks operators through compliance setup, writes `tino.deploy.json`.

## persistence

Two adapters, one interface (see [`packages/core/src/persistence/factory.ts`](../packages/core/src/persistence/factory.ts)):

| Adapter | When to use | What it backs |
|---|---|---|
| SQLite | Local dev | `./tino.db` for all stores; in-memory audit logger (entries lost on restart). |
| DynamoDB | Production | One table for every store + the audit logger. TTL on audit + history. KMS-encrypted with the component's CMK. |

The factory returns a single `Persistence` object containing all stores including the audit logger. The audit logger is co-located with the adapter that owns the underlying table — no second round of `if (adapter === 'dynamodb')` branching.

### the single-table layout

DynamoDB uses one table with `pk` (partition key) + `sk` (sort key) and one GSI (`gsi1pk` + `gsi1sk`). Every store reads/writes the same table with disjoint key prefixes:

| Store | `pk` pattern | `sk` pattern |
|---|---|---|
| Conversation history | `HISTORY#<userId>` | `<msgId>` |
| Tasks | `TASK#<userId>` | `<taskId>` |
| Preferences | `PREF#<userId>` | `<key>` |
| Config | `CONFIG` | `<key>` |
| Audit | `AUDIT#<paddedTs>#<userId>` | `AUDIT` |

This is documented in `packages/aws/src/persistence/dynamo/` and `packages/aws/src/audit/dynamo.ts:4`.

## tools and capabilities

A **tool** is a function the LLM can call. A **capability** is a bundle of related tools plus the credentials and config they need. Examples:

| Capability | Tools |
|---|---|
| GitHub | `searchGitHub`, `readGitHubFile`, `commentOnGitHub`, … |
| Linear | `searchLinear`, `createLinearIssue`, … |
| Google (Calendar + Gmail) | `getCalendarEvents`, `sendEmail`, … |
| Slack reading | `searchSlackMessages`, `readSlackThread` |
| CloudWatch | `queryCloudWatchLogs` |

Capability config schemas live in [`packages/core/src/capabilities/`](../packages/core/src/capabilities). The registry ([`registry.ts`](../packages/core/src/capabilities/registry.ts)) reads the config store at startup, instantiates only the capabilities with valid credentials, and registers their tools with the agent. On `POST /api/reload/capabilities` it does the same again — mutating the live `tools` map so the agent picks up changes without process restart.

## the scheduler

Background task runner — cron-style. Invoked with the same agent runtime and the same tools, but the result is posted to the owner's Slack DM via the proactive-DM helper instead of returned in a response.

Tasks are stored in DynamoDB (or SQLite). The scheduler polls every minute and dispatches due tasks. See [`packages/core/src/scheduler/`](../packages/core/src/scheduler) and `findWork` callbacks in `index.ts`.

## the agent loop

[`packages/core/src/agent/run.ts`](../packages/core/src/agent/run.ts) is one function: take a model, history, tools, user ID, and prompt → return text. It loops on tool calls until the model produces a final response or hits a tool-call limit.

Every tool call is recorded in the audit log with action `tool_call`, the tool name, the input parameter **keys** only (never values — values can contain PII), duration, and status (`success`, `error`, `denied`).

## the console server

Hono. One Hono app composes route modules:

- `routes/auth.ts` — Better Auth + Google sign-in middleware.
- `routes/config.ts` — config store CRUD.
- `routes/capabilities.ts` — capability metadata, toggle endpoint.
- `routes/compliance.ts` — the HIPAA dashboard.
- `routes/health.ts` — liveness.
- `routes/reload.ts` — `POST /api/reload/{slack,capabilities}`.
- `routes/admin.ts` — `POST /api/admin/restart` (graceful shutdown — ECS spins a new task).
- `routes/users.ts` — admin user management.
- `routes/bedrock.ts` — model validation endpoint.

The SPA is built by Vite into `dist/console-app/` and served as static assets. The auth middleware serves the SPA shell only on authenticated routes; the `/login` page is public.

## hot-reload

Two reload mechanisms:

1. **Slack reconnect** (`reconnectSlack()` in `index.ts`) — re-reads tokens from the config store, tears down the existing Bolt app and scheduler, constructs fresh ones. Module-scoped `let` for `app`/`postDm`/`stopScheduler` so the reload route AND the SIGTERM handler can both reach the lifecycle state.
2. **Capability reload** (`registry.reload()`) — re-reads capability config, instantiates new tools, mutates `registry.tools` in place. The agent loop reads `registry.tools` on every dispatch, so changes appear on the next message.

## security posture

Pinned to the code that enforces it:

- DynamoDB at rest: KMS-encrypted with the component's CMK (`tino-service.ts:386`).
- CloudWatch Logs at rest: KMS-encrypted (`tino-service.ts:400`).
- DynamoDB deletion protection: `pulumi destroy` fails until you flip it off in the console (`tino-service.ts:387`).
- IAM task role: scoped to the table ARN + region-scoped Bedrock when GDPR is on; no wildcard resources except `ecr:GetAuthorizationToken` (which AWS requires) (`tino-service.ts:614-670`).
- ECR images: scan-on-push enabled, mutable tags so `:latest` works for the docker-build provider (`tino-service.ts:507`).
- Container: `readonlyRootFilesystem: true`; `/tmp` is an ephemeral volume (`tino-service.ts:858`).
- ECS Exec: off by default; flip via `enableExec: true` (`tino-service.ts:914`).
- VPC Flow Logs (SOC 2): on by default; encrypted with the same CMK; 1-minute granularity (`tino-service.ts:445`).
- Audit retention: TTL-based; default 90 days (`packages/aws/src/audit/dynamo.ts:22`).
- HIPAA BAA gate: `pulumi up` throws unless `tino:baaAcknowledged=true` (`tino-service.ts:262`).

See [`security.md`](security.md) for the full enforcement matrix.

## the deploy pipeline

`tino init` (or hand-written Pulumi project) → `pulumi up` → ALB DNS or `consoleDomain`. The CLI generates `infra-tino/index.ts` that imports `TinoService`. `@pulumi/docker-build` builds the image as part of `pulumi up`, pushes to ECR, the task definition references the digest, and ECS picks up the new task.

There's no separate "build the image, push, then update task def" dance — the docker-build provider is part of the Pulumi resource graph.
