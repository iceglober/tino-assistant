# wave 3: make it seamless

config changes take effect immediately. deploys are one command. no manual task definition registration, no ECS restarts for config changes.

## items

### 3.1 hot-reload for Slack connection (gap #10)

**problem:** saving Slack tokens via the console writes to the config store but doesn't trigger a Slack reconnection. the running process reads tokens once at startup.

**fix:**
- after the console saves `slack.botToken` or `slack.appToken`, the server calls a function that:
  1. reads the new tokens from the config store
  2. if Slack is already connected → `app.stop()`, create new `App` with new tokens, `app.start()`
  3. if Slack is not connected → create `App` and `app.start()`
- the console's save handler calls a new API route: `POST /api/reload/slack`
- the route reads tokens from config, reconnects, returns success/failure

**acceptance:**
- [ ] save Slack tokens in the console → tino connects to Slack within 5 seconds (no restart)
- [ ] save new Slack tokens (rotate) → tino disconnects old, reconnects with new tokens
- [ ] if tokens are invalid → error message in the console, tino stays running (console still accessible)

### 3.2 hot-reload for capabilities (gap #9)

**problem:** adding a GitHub PAT via the console requires a restart to register the tools.

**fix:**
- after saving any capability credential, the console calls `POST /api/reload/capabilities`
- the route re-runs `buildTools` with the updated config store, replaces the tool set in the running agent
- the `runAgent` function uses the latest tool set (not a captured closure from startup)

**implementation:**
- `buildTools` returns a mutable reference (or the tools object is stored in a module-level variable that can be swapped)
- the reload route: read config → build tools → swap the reference → log what changed
- the system prompt's tool list is regenerated dynamically (already the case with `buildSystemPrompt()`)

**acceptance:**
- [ ] save a GitHub PAT in the console → `github tools enabled` appears in logs within 5 seconds
- [ ] the next Slack DM uses the new tools (no restart)
- [ ] removing a capability's credentials → tools are deregistered

### 3.3 fix deploy pipeline — no manual task def registration (gap #5, #14)

**problem:** every image push requires manually registering a new task definition and updating the service. the Pulumi docker-build provider pins to a digest, so `force-new-deployment` alone doesn't pick up new images.

**fix options:**
- **option A:** `tino deploy` command handles the full lifecycle: build → push → register task def with `:latest` (no digest pin) → update service. this bypasses Pulumi for the image update.
- **option B:** the Pulumi component uses `:latest` tag (not digest) in the task definition. `pulumi up` always triggers a new deployment because the image hash changes. this is the standard ECS deploy pattern.
- **option C:** separate the infrastructure (Pulumi) from the application deploy (CLI). Pulumi creates the infra once. `tino deploy` handles image build + push + ECS update without touching Pulumi.

**recommended:** option C. Pulumi owns infrastructure (DynamoDB, KMS, ALB, IAM, etc.). `tino deploy` owns the application (Docker build, ECR push, ECS rolling update). they're separate concerns with separate lifecycles.

**acceptance:**
- [ ] `tino deploy` builds the image, pushes to ECR, and updates the ECS service in one command
- [ ] no manual `aws ecs register-task-definition` needed
- [ ] no manual `aws ecs update-service` needed
- [ ] the deploy takes < 5 minutes end-to-end

### 3.4 console "restart tino" button (gap #12)

**problem:** as a stopgap until hot-reload is fully working, the console should have a way to trigger a restart.

**fix:**
- add a "restart" button in the console header (admin only)
- the button calls `POST /api/admin/restart`
- the route calls `process.exit(0)` — ECS automatically restarts the task
- show a "restarting..." message and auto-refresh after 30 seconds

**note:** this is a stopgap. once hot-reload (3.1 + 3.2) is working, the restart button becomes a fallback for edge cases.

**acceptance:**
- [ ] "restart" button visible in the console
- [ ] clicking it restarts the ECS task
- [ ] the console auto-refreshes and reconnects after ~30 seconds
