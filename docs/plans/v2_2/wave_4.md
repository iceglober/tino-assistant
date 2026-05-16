# wave 4: deploy verification

build the Docker image, push to ECR, deploy to ECS, and verify tino works end-to-end. this wave is the "it actually runs in production" gate.

## pre-requisites

- waves 0-1 complete (bun:sqlite migration + Dockerfile rewrite)
- waves 2-3 are nice-to-have but NOT blocking for deployment (linter + test coverage are quality gates, not runtime requirements)
- AWS credentials configured (`aws sso login --profile production/developer`)
- Pulumi stack `kn-eng/tino-infra/prod` accessible

## items

### 4.1 local smoke test with Bun runtime

before deploying, verify the full startup path works locally under Bun.

**steps:**
1. `bun run build` (tsc + vite build)
2. `PERSISTENCE_ADAPTER=sqlite bun run packages/core/dist/index.js` — should start the console on port 3001 without Slack (no tokens configured)
3. `curl http://localhost:3001/api/health` — should return `{ "ok": true, "tools": [...] }`
4. open `http://localhost:3001` in browser — should show the React SPA (login page or console depending on auth config)

**acceptance:**
- [ ] server starts without errors
- [ ] `/api/health` returns 200 with valid JSON
- [ ] React SPA loads (no blank page, no JS errors in console)
- [ ] no `ERR_DLOPEN_FAILED` or `better-sqlite3` errors in logs

**executor-context:**
- entrypoint: `packages/core/src/index.ts` (compiled to `packages/core/dist/index.js`); listen log emitted at `packages/core/src/server/index.ts:226` — `logger.info({ port, host: hostname }, 'config console listening')`
- health route source: `packages/core/src/server/routes/health.ts` (returns `{ ok, tools, uptime, capabilities }` — `tools` is an array of capability tool keys); mounted at `packages/core/src/server/index.ts:139`
- `PERSISTENCE_ADAPTER=sqlite` is the default (see `packages/core/src/persistence/factory.ts:38`); without it the server still uses sqlite, but setting it explicitly removes ambiguity. SQLite DB path defaults to `./tino.db`
- console hostname: when `CONSOLE_BASE_URL` is unset, server binds to `127.0.0.1` only (see `packages/core/src/server/index.ts:224`) — `curl localhost:3001` works, but other hosts on the LAN cannot reach it. Fine for local smoke test.
- build script: `bun run build` runs `@tino/core build` → `@tino/aws build` → `@tino/cli build` (see root `package.json` scripts). Core build = `tsc -p tsconfig.build.json && vite build`.
- failure signature for the bun:sqlite migration regression: `Error: ENOENT: no such file or directory, open ...better_sqlite3.node` or `ERR_DLOPEN_FAILED` — both indicate the prebuilt native module was not loaded. If wave 0 succeeded these should not appear.
- conventions: bun runtime (NOT node) is the target — invoke with `bun run …` not `node …`. ESM-only (`"type": "module"`). Workspaces: `packages/*`. Logger: pino (JSON logs, `pino-pretty` for dev).

### 4.2 Docker build + local container test

**steps:**
1. `docker build -t tino .` — should succeed with the new `oven/bun` base
2. `docker run --rm -p 3001:3001 -e PERSISTENCE_ADAPTER=sqlite -e CONSOLE_BASE_URL=http://localhost:3001 tino` — should start
3. `curl http://localhost:3001/api/health` — should return 200
4. verify logo loads: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/assets/tino-logo.png` — should return 200

**acceptance:**
- [ ] Docker build succeeds (no build errors)
- [ ] container starts and listens on port 3001
- [ ] health endpoint responds
- [ ] logo serves correctly from `/app/assets/tino-logo.png`

**executor-context:**
- Dockerfile: `Dockerfile` at repo root. Wave 0 rewrites the base from `node:22-slim` to `oven/bun:1` (or similar). Current pre-wave-0 file uses `FROM node:22-slim AS deps/runner` with `npm install -g bun` and `CMD ["node", "packages/core/dist/index.js"]` — wave 0 should change CMD to `bun` and drop the `npm install -g bun` step.
- assets dir: `assets/tino-logo.png` exists at repo root (only file in `assets/`); Dockerfile copies via `COPY assets ./assets`. Vite serves it from `/assets/tino-logo.png` at runtime (mounted as static).
- `CONSOLE_BASE_URL=http://localhost:3001` is REQUIRED when running in Docker — without it the server binds to `127.0.0.1` inside the container and the host port-forward sees no listener. Setting `CONSOLE_BASE_URL` flips the bind to `0.0.0.0` (see `packages/core/src/server/index.ts:224`).
- when running without Slack tokens, the server starts the console but skips `nextApp.start()` — you'll see `config console listening` but NOT `tino slack connected`. That is expected for the local container test.
- expected exit code on `docker build`: 0. On startup, `docker run` should keep running (foreground); use a second terminal for `curl`. `--rm` ensures cleanup on `ctrl+c`.
- conventions: Dockerfile is at repo root (single file, multi-stage). Image is published as `tino` locally; in production Pulumi tags it with the ECR repo URI. `ENTRYPOINT`/`CMD` after wave 0 is `bun packages/core/dist/index.js` (NOT `node`). Env vars are passed via `-e KEY=VALUE`; the container expects `PERSISTENCE_ADAPTER`, optionally `CONSOLE_BASE_URL` (presence flips bind to 0.0.0.0). Logs go to stdout as JSON (pino) — `docker logs <id>` will show line-delimited JSON.

### 4.3 deploy to ECS via Pulumi

**steps:**
1. `cd` to the infra-tino directory (in the kn-eng worktree)
2. update the Pulumi stack config if needed (e.g., if the Dockerfile base image change requires any config)
3. `pulumi up --yes --stack prod` — builds image, pushes to ECR, updates ECS task definition
4. wait for ECS to roll the new task (~2-3 minutes)

**what to watch for:**
- Pulumi should NOT try to replace the DynamoDB table (the `resourcePrefix` arg preserves existing names)
- the Docker build should succeed inside Pulumi's docker-build provider
- ECS should pick up the new task definition and start the container

**acceptance:**
- [ ] `pulumi up` succeeds without errors
- [ ] ECS task reaches RUNNING state
- [ ] CloudWatch logs show `config console listening` and `tino slack connected`

**executor-context:**
- infra-tino location: `/Users/austinhess/.glorious/worktrees/kn-eng/wt-260514-175943-q3b/infra-tino/` (kn-eng worktree). Stack file: `Pulumi.prod.yaml`; entrypoint: `index.ts` (32 lines, instantiates `new TinoService("tino", {…})` from `@tino/aws`).
- **resourcePrefix verification (IMPORTANT — the rollback section's claim needs to be reconciled before deploy):** `infra-tino/index.ts` does NOT pass `resourcePrefix`. In `packages/aws/src/pulumi/tino-service.ts:287` the prefix defaults to `args.resourcePrefix ?? name`, so with `new TinoService("tino", …)` the prefix is `"tino"` (NOT `"tino-tino"`). Existing AWS resources for this stack are therefore named with the `tino` prefix, not the legacy `tino-tino`. Before running `pulumi up`, run `pulumi preview --stack prod` and verify the DynamoDB table is `update`/`same`, NOT `replace`. If preview shows `replace` on the table → `resourcePrefix` is the wrong value for this stack — STOP and reconcile (do not blindly add `resourcePrefix: "tino-tino"`; check what the existing table is actually named with `aws dynamodb list-tables --profile production/developer | grep -i tino`).
- log group: `/ecs/tino` (matches the prefix above). Log strings to grep for: `config console listening` (emitted at `packages/core/src/server/index.ts:226`) and `tino slack connected` (emitted at `packages/core/src/index.ts:179`).
- Pulumi component source: `packages/aws/src/pulumi/tino-service.ts` — uses `@pulumi/docker-build` to build the image inside Pulumi (the Dockerfile at repo root is the build context).
- compliance enforcement: `tino.deploy.json` declares `frameworks: ["hipaa"]` and `baaStatus.aws: "manual-confirmed"`. Stack must have `pulumi config set tino:baaAcknowledged true` or deployment fails (see comments in `tino-service.ts:71-74`).
- AWS profile for Pulumi: `production/developer` (per pre-requisites). Stack: `kn-eng/tino-infra/prod`.
- conventions: Pulumi commands run from the `infra-tino/` directory (separate worktree). Always run `pulumi preview --stack prod` before `pulumi up` and read the diff carefully — `replace` on stateful resources (DynamoDB, ECR repos) is a STOP condition. Never pass `--skip-preview`. Stack outputs are read with `pulumi stack output <name> --stack prod`. CloudWatch log queries use the AWS profile `production/developer`: `aws logs tail /ecs/tino --profile production/developer --since 5m`. The `tino:baaAcknowledged` config key is required (HIPAA gate); set with `pulumi config set tino:baaAcknowledged true --stack prod` if `pulumi up` errors on it.

### 4.4 end-to-end verification

after ECS is running with the new image:

**console:**
- [ ] navigate to the ALB URL (`tino-alb-*.us-east-1.elb.amazonaws.com`)
- [ ] Google OAuth sign-in works
- [ ] console loads with capability cards
- [ ] can configure a capability (e.g., save a GitHub PAT) and see "connected" status

**Slack:**
- [ ] send a DM to tino in Slack
- [ ] tino responds (Bedrock agent loop works)
- [ ] tools work (e.g., ask tino to search GitHub, check Linear issues)

**hot-reload:**
- [ ] save a new capability credential in the console
- [ ] verify the capability registers without restart (check `/api/health` tools list)

**compliance:**
- [ ] `GET /api/compliance` returns real values (not all "unknown")
- [ ] audit entries are being written (check entry count > 0 after a few interactions)

**executor-context:**
- ALB DNS: `pulumi stack output consoleUrl --stack prod` (exported from `infra-tino/index.ts:28`). Note the production stack does NOT set `consoleDomain`, so the URL is the auto-generated ALB DNS (HTTP, not HTTPS via ACM).
- console SPA entry: `packages/core/src/console-app/` — health polling lives in `packages/core/src/console-app/hooks/useHealth.ts` (polls `/api/health` every 30s), capability "connected" status derives from the live health response (see `packages/core/src/console-app/lib/capabilityTools.ts:5`).
- compliance route: `packages/core/src/server/routes/compliance.ts` (mounted at `packages/core/src/server/index.ts:142`). It reads `process.env['PERSISTENCE_ADAPTER']` at line 84 — for the deployed task this MUST be `dynamodb`; otherwise compliance fields will report local-sqlite values that are wrong for production.
- Slack auth: `slack.botToken` and `slack.appToken` are stored in the DynamoDB config store (NOT env vars). The Slack connection is established in `packages/core/src/index.ts` around line 168-179; the success log is the proof.
- audit logger: `packages/core/src/audit/logger.ts` (and `packages/aws/src/audit/dynamo.ts` for the DynamoDB-backed adapter in production). Entry count check: `aws dynamodb scan --table-name tino-audit --select COUNT --profile production/developer` (table name pattern follows the prefix; verify exact name from `pulumi stack output` or by listing tables).
- hot-reload contract: capabilities register/unregister via the registry in `packages/core/src/capabilities/registry.ts` without a process restart. Verify by saving a credential, then re-curling `/api/health` and checking that `tools` array length increased.
- conventions: verification is observational — DO NOT edit code in this item. Use `curl -s` (silent) for health/compliance probes; pipe through `jq` for readability (`curl -s $URL/api/compliance | jq`). Health response shape is `{ ok: boolean, tools: string[], uptime: number, capabilities: Array<{id, toolCount, lastFindWorkScanAt, lastError}> }` (see `packages/core/src/server/routes/health.ts:18-30`). Compliance response shape includes `encryption: { dynamodb, secretsManager, cloudwatchLogs }` keyed by `PERSISTENCE_ADAPTER` (see `packages/core/src/server/routes/compliance.ts:84-99`). For Slack DM tests, use a real Slack workspace (no mock) and watch CloudWatch logs in parallel: `aws logs tail /ecs/tino --follow --profile production/developer`.

### 4.5 rollback plan

> **executor-note:** the `resourcePrefix: "tino-tino"` value referenced in bullet 2 below is a *legacy* value for older stacks that still use doubled resource names. The current `infra-tino/index.ts` does NOT pass `resourcePrefix`, so the prefix is `"tino"` (component name). Before relying on the rollback advice, confirm via 4.3's executor-context which prefix this stack actually uses (`pulumi preview` + `aws dynamodb list-tables`). The "ABORT on table replace" rule still applies regardless of prefix.

if the deployment fails:

1. **ECS task won't start:** check CloudWatch logs for the error. common causes:
   - `bun:sqlite` import fails → means the Bun runtime doesn't have SQLite compiled in (unlikely with `oven/bun:1` but check)
   - `@hono/node-server` incompatibility → fall back to previous task definition revision
2. **Pulumi replaces DynamoDB table:** ABORT immediately (`ctrl+c` during `pulumi up`). this means the `resourcePrefix` wasn't set correctly. verify `resourcePrefix: "tino-tino"` is set for existing deployments.
3. **Slack won't connect:** check that `slack.botToken` and `slack.appToken` are still in the DynamoDB config store. the migration from `better-sqlite3` to `bun:sqlite` only affects the auth session DB, not the config store (which is DynamoDB in production).

**to roll back:** `pulumi up` with the previous commit checked out (the old Dockerfile with `node:22-slim` and `better-sqlite3`). or: manually update the ECS service to use the previous task definition revision.

**executor-context:**
- previous task definition revisions are visible in the AWS console under ECS → Task definitions → `tino` family; CLI equivalent: `aws ecs list-task-definitions --family-prefix tino --profile production/developer --sort DESC`. Roll back with `aws ecs update-service --cluster tino --service tino --task-definition tino:<prev-revision> --profile production/developer`.
- the auth session DB (`tino.db` SQLite file) is ephemeral inside the ECS task — rolling back the runtime swap (bun:sqlite → better-sqlite3) does NOT lose user-facing state because OAuth sessions are short-lived and the durable config store is DynamoDB.
- `git log -- Dockerfile packages/core/src/persistence/sqlite.ts` shows the prior commits to revert to if a forward-fix isn't viable. `git revert <sha>` on the wave-0 commit, then `pulumi up`, is the cleanest rollback path.
- conventions: rollback is a recovery path, not a normal flow — narrate every step in chat before executing (no silent `pulumi up` after a failed deploy). NEVER `pulumi destroy`; that deletes resources. NEVER `git push --force` to revert wave 0 on `main`. ABORT (`ctrl+c`) on any `pulumi up` that previews a `replace` of DynamoDB/ECR/CloudWatch-LogGroup. Confirm with the user before invoking `aws ecs update-service` to pin a prior task-def revision (it bypasses the IaC source of truth and creates drift).

## dependency on other waves

- **wave 0 is required** — the Dockerfile and runtime changes are the deployment-critical items
- **wave 1 is recommended** — the Dockerfile cleanup (remove `src/` copies, add `tino.deploy.json`) improves the image but isn't blocking
- **waves 2-3 are NOT required for deployment** — linter and test coverage are quality gates for future development, not runtime requirements

## execution order for "deploy ASAP"

if you want to deploy as fast as possible:
1. wave 0 (bun:sqlite + Dockerfile) — **required**
2. wave 4 (deploy verification) — **required**
3. wave 1 (cleanup) — do after deployment is confirmed working
4. waves 2-3 (linter + tests) — do at leisure
