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

**files:**
- `packages/core/src/index.ts` (EDIT) — extract Slack-bring-up (lines ~98-142) into a `reconnectSlack(): Promise<void>` function holding `app`, `postDm`, `stopScheduler` in module-scoped `let`s; expose to console
- `packages/core/src/console/server.ts` (EDIT) — add `POST /api/reload/slack` route; accept a `reconnectSlack` callback in `startConsole(...)` args
- `packages/core/src/console/html.ts` (EDIT) — call `POST /api/reload/slack` from `saveSlack()` (~line 1590) after `putConfig`

**mirror:**
- the existing route handler shape in `server.ts` (e.g. `PUT /api/config/:key` at lines 111-152) is the mirror for the new `POST /api/reload/slack` route — same `readBody` → `JSON.parse` → action → `JSON.stringify` response pattern.
- `packages/core/src/slack/reset.ts` is the closest in-repo "tear down + recreate Slack state" mirror (used by Slack `/reset` slash command).

**context (index.ts current Slack lifecycle ~lines 98-142):**
```ts
const slackEnv = { ...env, SLACK_BOT_TOKEN: slackBotToken, SLACK_APP_TOKEN: slackAppToken, ALLOWED_SLACK_USER_ID: allowedUserId };
const handler: DmHandler = async (userId, text) =>
  runAgent({ model, history, logger, tools, userId, text, auditLogger });
const app = createSlackApp(slackEnv, handler, logger, history, auditLogger);
await app.start();
postDm = await createProactiveDm(app, allowedUserId, logger);
stopScheduler = startScheduler({ taskStore, logger, runTask, postResult: postDm });
```

**context (server.ts startConsole signature ~lines 30-37):**
```ts
export async function startConsole(
  config: ConfigStore,
  logger: AppLogger,
  tools: Record<string, unknown>,
  registry?: CapabilityRegistry,
  port = 3001,
  auditLogger?: AuditLogger,
): Promise<http.Server>
// → add: reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>
```

**conventions:**
- imports: ESM with `.js` extensions
- error handling: console reload routes return `{ ok: boolean, error?: string }` with HTTP 200 on user-visible failure (so the console JS can show a toast) and 500 only on server bugs
- audit logging: every reload writes a `config_change` entry (mirror lines 139-146 in `server.ts`)
- never throw across the Slack `app.stop()` boundary — wrap in try/catch with `logger.error({ err })`
- mutable module-scoped `let app: App | null = null` is acceptable here; document why a closure won't work

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

**files:**
- `packages/core/src/index.ts` (EDIT) — extract `reloadCapabilities(): Promise<{ ok: boolean }>`; the agent loop already references `registry.tools` (line 66) — switch to a closure-free getter
- `packages/core/src/capabilities/registry.ts` (EDIT) — expose `reloadAll()` that re-reads config and rebuilds tools without losing the existing pollers
- `packages/core/src/console/server.ts` (EDIT) — add `POST /api/reload/capabilities` route (mirror of 3.1's `POST /api/reload/slack`)
- `packages/core/src/console/html.ts` (EDIT) — call the reload route after each capability save in `putCapability(...)` (~line 1579)

**mirror:**
- 3.1's `POST /api/reload/slack` is the route-handler mirror once written
- existing dynamic tool list: `runAgent` already takes `tools` as a parameter on each call (`packages/core/src/index.ts:108`), so swapping the underlying object propagates immediately — no closure surgery required, just don't capture `Object.keys(tools)` once.

**context (index.ts agent dispatch ~line 107-109):**
```ts
const handler: DmHandler = async (userId, text) => {
  return runAgent({ model, history, logger, tools, userId, text, auditLogger });
};
```

**context (registry initialization ~lines 46-74):**
```ts
const registry = await initCapabilityRegistry({
  configStore, logger, allowedUserId, dbPath: env.DB_PATH, taskStore,
  onNewWork: async (summary) => { /* ... */ },
});
const tools = registry.tools;
```

**context (system prompt rebuild — confirm dynamic):**
- `packages/core/src/agent/systemPrompt.ts` exports `buildSystemPrompt()` which is already called per-request in `runAgent`. No change needed; just confirm it reads the live `tools` object, not a startup snapshot.

**conventions:**
- imports: ESM with `.js` extensions
- mutable references: prefer `registry.replaceTools(newTools)` over reassigning a module-level `let` — keeps the swap atomic and inside the registry boundary
- logging: emit `logger.info({ before: oldNames, after: newNames }, 'capabilities reloaded')` so operators can diff what changed
- error handling: if `buildTools` throws on a single capability, that capability stays disabled; do not roll back the whole reload (per existing `try/catch` per-capability pattern in `tools/index.ts:49-141`)
- tests: vitest; mock `ConfigStore` per `packages/core/tests/tools/preferences.test.ts` style

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

**files:**
- `packages/cli/src/commands/deploy.ts` (EDIT) — currently delegates everything to `executeDeploy` which runs `pulumi up`. Split into two paths: first-time (`pulumi up` for infra) vs subsequent (image-only via AWS SDK / docker CLI)
- `packages/cli/src/commands/deploy-executor.ts` (EDIT) — extract image-only deploy path (build → push → register task def revision → update-service)
- `packages/aws/src/pulumi/tino-service.ts` (EDIT) — under option C, drop the `dockerBuild.Image` resource and the digest pin in the task definition; have Pulumi reference `:latest` (or accept the image URI as an output the CLI updates)

**mirror:**
- existing `executeDeploy` in `packages/cli/src/commands/deploy-executor.ts` is the sequencing mirror — uses `execaCommandSync` + `displayStep(n, total, msg)`. Mirror that style for the new image-only path.
- AWS SDK clients in `packages/core/src/tools/cloudwatch/client.ts` show the `fromNodeProviderChain()` credential pattern; reuse for `@aws-sdk/client-ecr` and `@aws-sdk/client-ecs` in the CLI.

**context (current deploy-executor.ts ~lines 34-87):**
```ts
export async function executeDeploy(config: DeployConfig): Promise<void> {
  const cwd = process.cwd();
  const infraDir = resolve(cwd, config.infraPath ?? 'infra-tino');
  const stack = config.pulumiStack ?? 'dev';
  // Step 1: pulumi config set ...
  // Step 2: pulumi up --yes  ← currently does build+push+deploy
  run(`pulumi up --yes --stack ${stack}`, infraDir);
  displaySuccess('tino is deployed!');
}
```

**context (Pulumi image pinning — `packages/aws/src/pulumi/tino-service.ts` near `dockerBuild.Image` and `containerDefinitions` — ~lines 850-870):**
```ts
{ name: "tino", image: image.ref, ... }
// → image.ref is digest-pinned; that's why force-new-deployment alone doesn't pull a new image
```

**conventions:**
- imports: ESM with `.js` extensions; named imports
- CLI display: `displayStep(n, total, msg)`, `displaySuccess`, `displayError`, `displayInfo` from `../utils/display.js` — never use raw `console.log`
- AWS SDK: prefer the v3 modular clients (`@aws-sdk/client-ecr`, `@aws-sdk/client-ecs`) and `fromNodeProviderChain()`
- shell-out: use `execaCommandSync(cmd, { stdio: 'inherit', cwd })` (already in deploy-executor.ts:11) — never raw `child_process.exec`
- error handling: `try { ... } catch (err) { displayError(...); process.exit(1); }` — match existing pattern at deploy-executor.ts:82-86

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

**files:**
- `packages/core/src/console/server.ts` (EDIT) — add `POST /api/admin/restart` route; gate on session (already enforced by middleware) plus an admin allowlist check via `config.list()` filtering on `admin.<userId>`
- `packages/core/src/console/html.ts` (EDIT) — add restart button next to sign-out (~line 1222) and a `restartTino()` JS function (~near line 2061 alongside `signOut`); add a "restarting…" overlay

**mirror:**
- existing `signOut()` (`html.ts:~2061`) is the JS-helper mirror: `await fetch(...) → window.location.reload()`. Replace `signOut` URL with `/api/admin/restart` and the reload with a 30-second timer.
- existing `DELETE /api/users/:userId` route (`server.ts:287-322`) is the admin-only-write-with-audit mirror — copy the audit-logger call and 200-with-JSON response shape.

**context (server.ts shutdown pattern in index.ts ~lines 144-158):**
```ts
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'tino stopping');
  stopScheduler(); registry.stopAll(); consoleServer.close();
  try { await app.stop(); } catch { /* ... */ }
  process.exit(0);
};
process.on('SIGINT',  () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
```

**context (audit logging shape `server.ts:139-146`):**
```ts
if (auditLogger) {
  await auditLogger.log({
    userId: 'console',
    action: 'config_change',
    toolName: key,
    status: 'success',
  });
}
```

**conventions:**
- imports: ESM with `.js` extensions
- restart should call the in-process `shutdown` function (not raw `process.exit`) so scheduler/registry teardown runs first; expose `shutdown` to `startConsole` via the same plumbing as `reconnectSlack` in 3.1
- audit: emit a `'config_change'` (or new `'admin_restart'`) audit entry before triggering shutdown
- HTTP response: send 202 Accepted + `{ ok: true }` THEN call `setTimeout(() => shutdown('admin'), 100)` so the response flushes before the process exits
- console JS: same `async function` style as `signOut`; show a full-screen overlay during the 30-second wait, then `window.location.reload()`
- design tokens: reuse `--bg-deep` for the overlay and `--accent` for the spinner — do not introduce new colors

**acceptance:**
- [ ] "restart" button visible in the console
- [ ] clicking it restarts the ECS task
- [ ] the console auto-refreshes and reconnects after ~30 seconds
