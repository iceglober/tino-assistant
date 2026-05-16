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
- [~] (external) save Slack tokens in the console → tino connects to Slack within 5 seconds (no restart) — requires running Slack app + valid bot/app tokens; cannot be verified without real Slack workspace credentials
- [~] (external) save new Slack tokens (rotate) → tino disconnects old, reconnects with new tokens — requires real Slack
- [x] if tokens are invalid → error message in the console, tino stays running (console still accessible) — `tests/server/reload-routes.test.ts` "returns 200 + { ok: false, error } on user-visible failure (invalid tokens)"
- [x] regression test: `POST /api/reload/slack` returns 501 in wave 0's stub; wave 3 replaces with `{ ok: true }` for valid tokens and `{ ok: false, error }` for invalid — `tests/server/reload-routes.test.ts` covers the 501 stub regression and the success / failure paths

**post-wave-0 routing notes:**
- Live route file: `packages/core/src/server/routes/reload.ts` (currently a 501 stub; wave 3 replaces). Mount point is already wired via `server/index.ts:123` (`app.route('/api/reload', createReloadRoutes())`) — extend the factory signature to accept the `reconnectSlack` callback.
- Live UI save: `packages/core/src/console-app/pages/Console.tsx:85-98` (`onSaveSlack`). After `putConfig('slack.botToken', …)`, call a new `reloadSlack()` helper added to `console-app/lib/api.ts` (mirror of `putConfig`).
- The `index.ts` Slack lifecycle (`packages/core/src/index.ts:106-150`) is the canonical mirror — the `reconnectSlack` function should perform the same `app.stop() → createSlackApp(…) → app.start()` sequence. Module-scoped `let app, postDm, stopScheduler` is the simplest approach; document why a closure won't work in the JSDoc.

**context (current reload stub `server/routes/reload.ts:1-19`):**
```ts
export function createReloadRoutes(): Hono {
  const app = new Hono();
  app.post('/slack', (c) => c.json({ ok: false, error: 'not implemented (wave 3)' }, 501));
  app.post('/capabilities', (c) => c.json({ ok: false, error: 'not implemented (wave 3)' }, 501));
  return app;
}
```

**context (target signature for wave 3 — extend `createReloadRoutes` factory):**
```ts
export function createReloadRoutes(opts: {
  reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>;
  reloadCapabilities?: () => Promise<{ ok: boolean; error?: string }>;
  auditLogger?: AuditLogger;
}): Hono { /* … */ }
```

**context (`StartServerOptions` extension at `server/index.ts:42-49` — add the two callbacks):**
```ts
export interface StartServerOptions {
  config: ConfigStore; logger: AppLogger; tools: Record<string, unknown>;
  registry?: CapabilityRegistry; port?: number; auditLogger?: AuditLogger;
  reconnectSlack?: () => Promise<{ ok: boolean; error?: string }>;
  reloadCapabilities?: () => Promise<{ ok: boolean; error?: string }>;
}
```

**conventions:**
- imports: ESM with `.js` extensions
- error handling: reload routes return `{ ok: boolean, error?: string }` with HTTP 200 on user-visible failure (so the console JS can show a toast) and 500 only on server bugs
- audit logging: every reload writes a `config_change` entry — mirror the shape at `server/routes/config.ts:46-53`
- never throw across the Slack `app.stop()` boundary — wrap in try/catch with `logger.error({ err })`
- mutable module-scoped `let app: App | null = null` is acceptable here; document why a closure won't work
- tests: vitest; mock `@slack/bolt` `createSlackApp` and assert the start/stop sequence

**mocks:**
- `createSlackApp` from `packages/core/src/slack/app.js`: `vi.fn()` returning `{ start: vi.fn(), stop: vi.fn() }` — assert both called in the right order
- `createProactiveDm`: `vi.fn()` returning `async () => undefined` — no real Slack
- `ConfigStore`: in-memory test double (Map-backed) loaded with `slack.botToken` / `slack.appToken` / `slack.adminUserId`
- audit logger: in-memory implementation from `packages/core/src/audit/memory.ts`

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
- [x] save a GitHub PAT in the console → `github tools enabled` appears in logs within 5 seconds — `tests/capabilities/registry-reload.test.ts` test 1 ("starting empty → reload after adding github config registers github tools") asserts both the registered tools and the `'capabilities reloaded'` info log
- [x] the next Slack DM uses the new tools (no restart) — `tests/capabilities/registry-reload.test.ts` test 2 ("tools reference is mutated in place") locks the in-place swap so consumers holding the captured `registry.tools` reference see the new toolset on the next call
- [x] removing a capability's credentials → tools are deregistered — `tests/capabilities/registry-reload.test.ts` test 3 ("removing credentials → github tools are deregistered")

**post-wave-0 routing notes:**
- Live route: `packages/core/src/server/routes/reload.ts` (same stub as 3.1; same factory extension). Wave 3 fills in `app.post('/capabilities', …)` to call `opts.reloadCapabilities()`.
- Live registry: `packages/core/src/capabilities/registry.ts` — extend the `CapabilityRegistry` interface (`capabilities/types.ts:58-68`) with `reload(): Promise<{ ok: boolean }>` that re-runs the loop at `registry.ts:78-124`, builds a fresh `tools: ToolSet`, and atomically swaps it.
- The agent already reads `registry.tools` per request (`index.ts:67`, `index.ts:115-117`) — swapping the underlying object mutates the visible toolset without surgery as long as `runAgent` doesn't snapshot `Object.keys(tools)` at startup. Verify by reading `packages/core/src/agent/run.ts` before changing the swap mechanism.
- UI save: `packages/core/src/console-app/components/CapabilityCard.tsx:70-81` (`onSave`) calls `putCapability(...)`; after success it should call a new `reloadCapabilities()` helper in `console-app/lib/api.ts`.

**context (capabilities/registry.ts:78-124 — the loop that wave 3 must extract into `reload()`):**
```ts
for (const cap of ALL_CAPABILITIES) {
  const raw = await configStore.get(`capability.${cap.id}`);
  if (raw === null) { state[cap.id] = { toolCount: 0 }; continue; }
  let config: CapabilityConfig;
  try { config = JSON.parse(raw) as CapabilityConfig; } catch { /* skip */ }
  if (!config.enabled) { state[cap.id] = { toolCount: 0 }; continue; }
  const toolsBefore = Object.keys(tools).length;
  try {
    await cap.registerTools(config, configStore, logger, tools);
    state[cap.id] = { toolCount: Object.keys(tools).length - toolsBefore };
  } catch (err) {
    logger.warn({ capabilityId: cap.id, err: (err as Error).message }, `${cap.displayName} tools disabled`);
    state[cap.id] = { toolCount: 0, lastError: (err as Error).message };
  }
}
```

**context (`CapabilityRegistry` interface to extend at `capabilities/types.ts:58-68`):**
```ts
export interface CapabilityRegistry {
  tools: ToolSet;
  stopAll(): void;
  getState(): Record<string, CapabilityRuntimeState>;
  capabilityIds: string[];
  // ← add: reload(): Promise<{ ok: boolean; error?: string }>;
}
```

**conventions:**
- imports: ESM with `.js` extensions
- mutable references: prefer `registry.replaceTools(newTools)` style (a method on the registry) over reassigning a module-level `let` — keeps the swap atomic and inside the registry boundary. Inside `replaceTools`, use `for (const k of Object.keys(currentTools)) delete currentTools[k]; Object.assign(currentTools, newTools)` so external holders of the same `tools` reference see the new toolset.
- logging: emit `logger.info({ before: oldNames, after: newNames }, 'capabilities reloaded')` so operators can diff what changed
- error handling: if a single capability throws on reload, that capability stays disabled; do not roll back the whole reload (per the existing per-capability try/catch in `registry.ts:101-109`)
- tests: vitest; mock `ConfigStore` with an in-memory Map per the `tests/tools/preferences.test.ts` style; mock `Octokit` / `LinearClient` / etc. so registry tests don't hit real APIs

**mocks:**
- `Octokit`, `LinearClient`, `googleapis`, `@aws-sdk/client-cloudwatch-logs`: `vi.mock(...)` per-module returning stub constructors
- `ConfigStore`: in-memory Map-backed test double — implement `get`/`set`/`list`/`delete`/`getTyped` matching the interface
- `AppLogger`: `{ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }` — assert reload-log line was emitted

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
- [~] (external) `tino deploy` builds the image, pushes to ECR, and updates the ECS service in one command — requires real AWS creds, ECR registry, ECS cluster
- [~] (external) no manual `aws ecs register-task-definition` needed — verifiable only against a real ECS deployment
- [~] (external) no manual `aws ecs update-service` needed — same as above
- [~] (external) the deploy takes < 5 minutes end-to-end — wall-clock measurement against real AWS
- [~] regression test: invoking `executeDeploy` (or its split successors) calls the expected sequence of shell commands in order. **Descoped** — see `## Open questions` item 1. Vitest's `vi.mock('execa', …)` from `@tino/core`'s harness does not intercept the bare specifier when `deploy-executor.ts` resolves it from `packages/cli/node_modules/`. The recommended option C (split Pulumi from CLI deploy) would replace `executeDeploy` entirely; adding a vitest harness to `@tino/cli` for tests that will be deleted is wasted plumbing. Tracked for the wave that lands option C.
- [x] regression test: when `infraDir` is missing, `executeDeploy` calls `displayError` + `process.exit(1)` — `tests/cli/deploy-executor.test.ts` "calls displayError + process.exit(1) when the infra directory does not exist" mocks `process.exit` to throw a sentinel and asserts the abort path runs before any shell-out

**post-wave-0 routing notes:**
- Wave 0 did NOT touch this — the CLI deploy path (`packages/cli/src/commands/deploy-executor.ts`) is unchanged. The plan's references to that file are still accurate.
- Recommended approach (option C from the plan): keep `pulumi up` for infrastructure (DynamoDB, KMS, ALB, IAM); add a separate code-deploy path that runs `docker build` → `aws ecr get-login-password | docker login` → `docker push` → `aws ecs update-service --force-new-deployment`. The image-tag pin in `tino-service.ts:855-870` is the gating issue — Pulumi's `dockerBuild.Image` outputs a digest that survives across deploys, so `force-new-deployment` alone re-runs the same image. Either drop the `dockerBuild.Image` pin (let CI/CLI manage the tag) or move image management out of Pulumi entirely.

**context (deploy-executor.ts current sequencing ~lines 51-86):**
```ts
displayStep(1, 2, 'Configuring Pulumi stack');
run(`pulumi config set aws:region ${region} --stack ${stack}`, infraDir);
// … more pulumi config set lines …
displayStep(2, 2, 'Deploying (pulumi up — builds image, pushes to ECR, deploys service)');
run(`pulumi up --yes --stack ${stack}`, infraDir);
displaySuccess('tino is deployed!');
```

**conventions:**
- imports: ESM with `.js` extensions; named imports
- CLI display: `displayStep(n, total, msg)`, `displaySuccess`, `displayError`, `displayInfo` from `../utils/display.js` — never use raw `console.log`
- AWS SDK: prefer the v3 modular clients (`@aws-sdk/client-ecr`, `@aws-sdk/client-ecs`) and `fromNodeProviderChain()`
- shell-out: use `execaCommandSync(cmd, { stdio: 'inherit', cwd })` (already in deploy-executor.ts:11) — never raw `child_process.exec`
- error handling: `try { … } catch (err) { displayError(...); process.exit(1); }` — match existing pattern at deploy-executor.ts:82-86
- tests: vitest; `vi.mock('execa', () => ({ execaCommandSync: vi.fn() }))` and assert call-order

**mocks:**
- `execa`: `vi.mock('execa', () => ({ execaCommandSync: vi.fn() }))` — assert ordered calls
- `@aws-sdk/client-ecr`, `@aws-sdk/client-ecs`: `vi.mock(...)` returning stub `send()` methods that resolve with deterministic responses
- `process.exit`: `vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never)` — turn exit into a thrown error so the test can assert it
- filesystem reads (`readFileSync`, `statSync`): mock via `vi.mock('node:fs', …)` to return synthetic infra-dir layouts

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
- [x] "restart" button visible in the console — `tests/console-app/header-restart-button.test.ts` renders `<Header />` via `renderToString` and asserts the `>restart<` button + `aria-label="Restart tino"` are present; a second test confirms the button is hidden when no session is active. (Note: rendered via `react-dom/server` rather than jsdom — see `## Open questions` item 2 for the rationale.)
- [~] (external) clicking it restarts the ECS task — requires running ECS task; only the `process.exit(0)` call path is testable locally
- [~] (external) the console auto-refreshes and reconnects after ~30 seconds — requires real ECS rolling restart timing
- [x] regression test: `POST /api/admin/restart` calls the injected `shutdown` callback AFTER returning 202 — `tests/server/admin-routes.test.ts` "returns 202 with { ok: true } before the shutdown callback fires" uses fake timers to assert the response is sent before the deferred `setTimeout(shutdown, 100)` fires; companion tests cover the audit-log entry and a rejecting shutdown.

**post-wave-0 routing notes:**
- Live route file: NEW `packages/core/src/server/routes/admin.ts` (mirror `routes/users.ts:16-55` for the factory shape and audit-log handling). Mount at `server/index.ts:117-123` via `app.route('/api/admin', createAdminRoutes({ logger, auditLogger, shutdown }))`.
- Live UI: extend `packages/core/src/console-app/components/Header.tsx` (the existing `signOut` button at `Header.tsx:39-41` is the visual mirror) — add a sibling `restart` button that calls a new `restartTino()` helper in `console-app/lib/api.ts`.
- The `shutdown` function is already defined inline in `index.ts:152-163` (Slack-connected branch) and `index.ts:173-179` (no-Slack branch). Refactor: hoist into a named `createShutdown(...)` returning a `(signal: string) => Promise<void>` that closures over `stopScheduler`, `registry`, `consoleServer`, `app`. Pass that into `startServer({ … shutdown })`.

**context (existing shutdown at index.ts:152-163):**
```ts
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'tino stopping');
  stopScheduler(); registry.stopAll(); consoleServer.close();
  try { await app.stop(); } catch (err) { logger.error({ err }, 'error stopping slack app'); }
  process.exit(0);
};
```

**context (`routes/users.ts` factory mirror — lines 16-55):**
```ts
export function createUsersRoutes(opts: {
  config: ConfigStore; logger: AppLogger; auditLogger: AuditLogger | undefined;
}): Hono {
  const app = new Hono();
  app.delete('/:userId', async (c) => { /* … audit + action … */ });
  return app;
}
```

**context (audit logging shape, mirror this in the restart route — `routes/config.ts:46-53`):**
```ts
if (auditLogger) {
  await auditLogger.log({
    userId: 'console',
    action: 'config_change',  // ← change to 'admin_restart' once that action is added to the AuditEntry union
    toolName: key,
    status: 'success',
  });
}
```

**conventions:**
- imports: ESM with `.js` extensions
- restart should call the in-process `shutdown` function (not raw `process.exit`) so scheduler/registry teardown runs first; expose `shutdown` to `startServer` via the `StartServerOptions` extension from 3.1
- audit: extend the `AuditEntry['action']` union at `packages/core/src/audit/logger.ts:17-25` with `'admin_restart'` — the union is intentionally narrow and adding a new action requires the type change
- HTTP response: send 202 Accepted + `{ ok: true }` THEN call `setTimeout(() => shutdown('admin'), 100)` so the response flushes before the process exits
- design tokens: reuse existing tokens from `console-app/styles/tokens.css` for the restart-overlay; do not introduce new colors
- React: function components only; use `useState` for the "restarting…" flag; `setTimeout(window.location.reload, 30000)` after the 202

**mocks:**
- `process.exit`: `vi.spyOn(process, 'exit').mockImplementation((code?: number) => { throw new Error(`exit ${code}`); })` so the test can assert it was reached without killing the test runner
- `shutdown` callback: `vi.fn().mockResolvedValue(undefined)` injected into `createAdminRoutes` — assert it's called after the response
- audit logger: in-memory implementation from `packages/core/src/audit/memory.ts`

## Open questions

Decisions made during wave 3 implementation that defer work to a future wave. Each entry names the trade-off and the conditions for picking it back up.

1. **3.3 — ordered shell-command snapshot test for `executeDeploy` is descoped.** The plan's recommended fix is option C (split Pulumi-managed infra from CLI-managed image deploy). That refactor would replace `executeDeploy` entirely with a new code path that calls `aws ecr get-login-password` / `docker push` / `aws ecs update-service` directly — at which point a snapshot of "the old `pulumi up` command sequence" is gone. The mechanical blocker for testing the *current* sequence is that `execa` is installed only under `packages/cli/node_modules/`, and the test would run from `@tino/core`'s vitest harness (the only package with a configured vitest at the time of writing). Vitest's `vi.mock('execa', …)` does not intercept the bare specifier when `deploy-executor.ts` resolves it from a different `node_modules` tree than the test file — the mock factory loads, but the deploy-executor's `import` still lands on the real `execa`, which then tries to shell out to real `pulumi`. **Pick this up when:** option C lands (or earlier, if `@tino/cli` grows its own vitest harness for unrelated reasons). At that point the snapshot becomes a sequence of AWS-SDK calls + a single `docker push`, not a `pulumi` invocation, and the cross-package mock issue dissolves.

2. **3.4 — header restart-button visibility test uses `react-dom/server` instead of jsdom.** The plan called for "render `<Header>` in jsdom, assert button presence." Adding `jsdom` + `@testing-library/react` for one substring assertion would be two new devDependencies plus a vitest environment switch. `renderToString` already ships with `react-dom`, requires no environment, and exercises the same render path. The tests at `packages/core/tests/console-app/header-restart-button.test.ts` assert (a) `>restart<` is present in the markup when a session is active, (b) `aria-label="Restart tino"` is present, and (c) the button is hidden without a session. The interaction path (click → POST `/api/admin/restart`) is covered server-side by `tests/server/admin-routes.test.ts`. **Pick this up when:** another wave needs full DOM/event simulation (e.g., focus-trap, keyboard navigation, useEffect timer assertions). At that point install jsdom + RTL once and migrate this test alongside the new ones.

3. **3.3 — option C (separate Pulumi-infra from CLI-image-deploy) is not implemented in wave 3.** Items 3.1, 3.2, and 3.4 deliver the wave goal "config changes take effect immediately." The second half of the goal — "deploys are one command" — requires AWS-SDK-driven build/push/update-service code in the CLI plus dropping `dockerBuild.Image` from `tino-service.ts`. None of 3.3's automatable acceptance items force that refactor in this wave, and the external items (`tino deploy < 5 min`, no manual `register-task-definition`) are gated on a deploy environment that isn't set up here. **Pick this up when:** the team has a target AWS account, ECR registry, and ECS cluster ready to test against. The plan's `## fix options` section already enumerates the recommended path.

## Post-implementation actions

External items in this wave that require manual verification after deployment:

- **3.1** — after deploying with new Slack-reload code, save Slack tokens via the console and confirm the bot connects within 5 seconds (no ECS restart). Rotate the bot token, save again, confirm reconnection. Try an obviously invalid token, confirm the console shows an error and tino stays running.
- **3.3** — after the new deploy pipeline ships, run `tino deploy` end-to-end against a real AWS account: time it (target < 5 minutes), confirm no manual `aws ecs register-task-definition` or `aws ecs update-service` was required, confirm the service picks up the new image without operator intervention.
- **3.4** — after restart-button code ships, click the button in a deployed console, confirm ECS rolls the task and the console auto-reconnects within ~30 seconds. Confirm the audit log captures an `admin_restart` entry attributed to the console user.
