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

### 4.5 rollback plan

if the deployment fails:

1. **ECS task won't start:** check CloudWatch logs for the error. common causes:
   - `bun:sqlite` import fails → means the Bun runtime doesn't have SQLite compiled in (unlikely with `oven/bun:1` but check)
   - `@hono/node-server` incompatibility → fall back to previous task definition revision
2. **Pulumi replaces DynamoDB table:** ABORT immediately (`ctrl+c` during `pulumi up`). this means the `resourcePrefix` wasn't set correctly. verify `resourcePrefix: "tino-tino"` is set for existing deployments.
3. **Slack won't connect:** check that `slack.botToken` and `slack.appToken` are still in the DynamoDB config store. the migration from `better-sqlite3` to `bun:sqlite` only affects the auth session DB, not the config store (which is DynamoDB in production).

**to roll back:** `pulumi up` with the previous commit checked out (the old Dockerfile with `node:22-slim` and `better-sqlite3`). or: manually update the ECS service to use the previous task definition revision.

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
