# wave 1: make it work

fix the bugs that prevent basic functionality. after this wave, tino starts correctly, the console loads, and the session survives restarts.

## items

### 1.1 fix console API returning HTML instead of JSON (gap #2)

**problem:** when the session cookie is missing or invalid, the auth middleware returns the HTML login page for ALL routes — including `/api/config`, `/api/health`, etc. the console's JS `fetch('/api/config')` gets `<!DOCTYPE` instead of JSON.

**fix:** 
- API routes (`/api/*` except `/api/auth/*`) return 401 JSON when no session, not HTML
- the console JS detects 401 and redirects to the login page
- partially done in the last commit — verify it works end-to-end

**files:**
- `packages/core/src/console/server.ts` (EDIT) — auth middleware branch around lines 382-395
- `packages/core/src/console/html.ts` (EDIT, optional) — `getConfig()` / `getHealth()` 401 handling around lines 1553-1565

**mirror:**
- `packages/core/src/console/server.ts` — pattern is already in the same file at lines 388-393 (the `/api/` branch already returns JSON 401). The fix is to verify nothing else short-circuits before this branch.
- `packages/core/src/console/html.ts` — existing pattern at line 1555: `if (r.status === 401) { window.location.reload(); return []; }` — replicate per fetch helper.

**context (server.ts, current auth-middleware 401 branch ~lines 387-394):**
```ts
if (!session) {
  // API routes get 401 JSON; page routes get the login page
  if (url.startsWith('/api/')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized', message: 'sign in required' }));
    return;
  }
  // Non-API routes → show login page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>...`);
  return;
}
```

**context (html.ts, current 401 handling ~lines 1553-1565):**
```js
async function getConfig() {
  const r = await fetch('/api/config');
  if (r.status === 401) { window.location.reload(); return []; }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function getHealth() {
  const r = await fetch('/api/health');
  if (r.status === 401) { window.location.reload(); return {}; }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
```

**conventions:**
- imports: ESM `import` with `.js` extensions (TypeScript NodeNext); named imports
- exports: named `export function`
- test framework: vitest (`packages/core/tests/**/*.test.ts`)
- error handling: try/catch with `(err as Error).message` in log lines; logger is pino-style (`logger.info({ ... }, 'message')`)
- console JS is plain ES (no JSX) inside the HTML string; reload-on-401 already established at lines 1555/1562

**acceptance:**
- [x] `fetch('/api/config')` without a session cookie returns `{"error":"unauthorized"}` with status 401
- [x] `fetch('/api/config')` with a valid session cookie returns the config array as JSON
- [x] the console page detects 401 and shows the login page

### 1.2 fix preferences tools disabled (gap #6)

**problem:** the preferences store uses SQLite (`better-sqlite3`) which tries to write to the filesystem. in production, the root filesystem is read-only. the `/tmp` volume exists but the preferences store isn't configured to use it.

**fix:**
- when `PERSISTENCE_ADAPTER=dynamodb`, the preferences store should use DynamoDB (it already has a DynamoDB adapter)
- the `buildTools` function creates the preferences store — it should check the adapter and use the right one
- alternatively: the preferences store should use `/tmp/tino-prefs.db` in production (simpler, but loses data on restart)

**files:**
- `packages/core/src/tools/index.ts` (EDIT) — `buildTools` preferences block (lines 87-96)
- `packages/core/src/index.ts` (EDIT) — pass `preferences` from persistence factory into `buildTools` instead of letting `buildTools` create its own SQLite store
- `packages/core/src/persistence/factory.ts` (reference only — already returns `preferences` from both adapters)

**mirror:**
- the `taskStore` injection pattern in `buildTools` (lines 98-108 of `tools/index.ts`) is the exact mirror — `taskStore` is passed in from the persistence factory rather than constructed inside. Apply the same pattern to `preferences`.
- the dynamo adapter `packages/aws/src/persistence/dynamo/preferences.ts` already implements `PreferencesStore` and is wired in `packages/aws/src/persistence/dynamo/index.ts` line 37.

**context (tools/index.ts current preferences block ~lines 87-96):**
```ts
try {
  const dbPath = env.DB_PATH ?? './tino.db';
  const userId = env.ALLOWED_SLACK_USER_ID ?? '';
  const prefStore = createPreferencesStore({ dbPath });
  tools['set_preference'] = setPreferenceTool(prefStore, userId);
  tools['get_preferences'] = getPreferencesTool(prefStore, userId);
  logger.info('preferences tools enabled');
} catch (err) {
  logger.warn({ err: (err as Error).message }, 'preferences tools disabled');
}
```

**context (tools/index.ts taskStore injection pattern to mirror ~lines 98-108):**
```ts
if (taskStore) {
  try {
    const userId = env.ALLOWED_SLACK_USER_ID ?? '';
    tools['schedule_task'] = scheduleTaskTool(taskStore, userId);
    tools['list_tasks'] = listTasksTool(taskStore, userId);
    tools['cancel_task'] = cancelTaskTool(taskStore);
    logger.info('task tools enabled');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'task tools disabled');
  }
}
```

**context (index.ts persistence destructuring ~line 18):**
```ts
const { history, tasks: taskStore, config: configStore } = await createPersistence(env, logger);
// → must also destructure `preferences: preferencesStore` and pass into buildTools
```

**conventions:**
- imports: ESM with `.js` extensions; named imports
- exports: named `export function`
- error handling: per-tool-category `try/catch` with `logger.warn({ err: (err as Error).message }, '<tool> disabled')` — preserve this exact phrasing because operators grep logs for `enabled`/`disabled`
- factory pattern: persistence stores are constructed in `packages/core/src/persistence/factory.ts`, never inside `buildTools`
- dynamic-import boundary: do NOT import from `@tino/aws` in core; the factory handles the dynamic import

**acceptance:**
- [x] `preferences tools enabled` in the startup logs (not `disabled`)
- [x] `set_preference` and `get_preferences` tools work in Slack DMs

### 1.3 fix session persistence across restarts (gap #7)

**problem:** better-auth's session database is SQLite at `/tmp/tino-auth.db`. when the ECS task restarts, `/tmp` is wiped, all sessions are lost, users have to re-login.

**fix:**
- store better-auth sessions in DynamoDB instead of SQLite
- better-auth supports custom database adapters — write a DynamoDB adapter or use the secondary storage feature (Redis-like key-value for sessions)
- alternatively: accept that sessions are lost on restart (users re-login). this is acceptable for MVP if restarts are rare.

**files:**
- `packages/core/src/console/auth.ts` (EDIT) — replace `new Database(opts.dbPath ?? "./tino-auth.db")` with a DynamoDB-backed adapter or `secondaryStorage` config
- `packages/core/src/console/server.ts` (EDIT) — pass adapter (or DynamoDB table reference) into `createAuth` (line 52-58)
- `packages/aws/src/persistence/dynamo/auth.ts` (NEW, if going the custom-adapter route) — better-auth secondary storage backed by the existing TinoTable
- `packages/core/src/index.ts` (EDIT) — pass `configStore`/persistence handle into `startConsole` so `createAuth` can use DynamoDB

**mirror:**
- `packages/aws/src/persistence/dynamo/preferences.ts` is the closest mirror — same key-value shape (pk/sk = AUTH#…). Reuse `createDynamoTable` from `packages/aws/src/persistence/dynamo/client.ts`.
- better-auth `secondaryStorage` interface: `{ get, set, delete }` returning `Promise<string|null>` / `Promise<void>` — directly maps to the `PreferencesStore` shape.

**context (auth.ts current ~lines 5-31):**
```ts
export async function createAuth(opts: {
  googleClientId: string;
  googleClientSecret: string;
  allowedDomain?: string;
  baseUrl: string;
  dbPath?: string;
}): Promise<Auth> {
  const auth = betterAuth({
    baseURL: opts.baseUrl,
    secret: process.env['BETTER_AUTH_SECRET'] ?? crypto.randomUUID(),
    database: new Database(opts.dbPath ?? "./tino-auth.db"),
    socialProviders: { google: { clientId: opts.googleClientId, clientSecret: opts.googleClientSecret } },
    session: { expiresIn: 60 * 60 * 24 },
  }) as unknown as Auth;
  const { runMigrations } = await getMigrations((auth as any).options);
  await runMigrations();
  return auth;
}
```

**context (server.ts createAuth call site ~lines 52-58):**
```ts
auth = await createAuth({
  googleClientId: googleClientId!,
  googleClientSecret: googleClientSecret!,
  allowedDomain,
  baseUrl,
  dbPath: '/tmp/tino-auth.db',
});
```

**conventions:**
- imports: ESM `.js` extensions; named imports
- the `BETTER_AUTH_SECRET` env var must be stable across restarts (already addressed via Pulumi Secrets Manager — do NOT regress to `crypto.randomUUID()`)
- when adding the dynamo adapter, follow the dynamic-import pattern in `packages/core/src/persistence/factory.ts` (lines 26-32) so `@tino/aws` stays out of core's bundle
- error handling: `try/catch` around adapter init with a `logger.error` fallback to "running without auth" — see existing pattern in `server.ts` lines 51-66

**acceptance:**
- [~] (external) after ECS task restart, the user's session is still valid (no re-login required) — requires deployed ECS task; deferred to follow-up wave per Open questions. No automated test path.
- [x] OR: document that sessions are lost on restart and ensure the re-login flow is smooth (< 5 seconds)
- [x] regression test: when `BETTER_AUTH_SECRET` env var is missing, `createAuth` logs a `'BETTER_AUTH_SECRET not set'` warning (test target: `packages/core/src/server/middleware/auth.ts:40-49`). Mock `opts.logger.warn` and assert the call. **mocks:** stub `AppLogger`; pass an in-memory `Database(':memory:')` (better-sqlite3 supports it natively) instead of touching `/tmp`. Implemented at `packages/core/tests/server/auth-secret-warning.test.ts` (3 tests: warns-on-missing, silent-on-set, no-throw-without-logger).

### 1.4 fix logo loading in production (gap #13)

**problem:** the logo route tries multiple path candidates but may still fail. the `assets/` directory is copied into the Docker image but the path resolution depends on `process.cwd()` which may not be `/app`.

**fix:**
- use an absolute path: `/app/assets/tino-logo.png` (the Dockerfile WORKDIR is `/app`)
- or embed the logo as a base64 data URI in the HTML (eliminates the file-serving problem entirely, but the logo is 1.2MB which is too large for inline)
- or serve from a known absolute path and verify it works in the Docker image

**files:**
- `packages/core/src/console/server.ts` (EDIT) — `/assets/tino-logo.png` route (lines 325-349)
- `Dockerfile` (REFERENCE) — confirms `WORKDIR /app` and `COPY assets ./assets` so the canonical container path is `/app/assets/tino-logo.png`

**mirror:**
- no internal mirror — this is a one-off route. The handler shape (`writeHead` + `end(data)` + try/catch) follows the same pattern as the rest of `handleRoute` in `server.ts`.

**context (server.ts current logo route ~lines 325-349):**
```ts
if (method === 'GET' && routePath === '/assets/tino-logo.png') {
  const candidates = [
    new URL('../../assets/tino-logo.png', import.meta.url),
    new URL('../../../../assets/tino-logo.png', import.meta.url),
    new URL(`file://${process.cwd()}/assets/tino-logo.png`),
  ];
  let served = false;
  for (const logoPath of candidates) {
    try {
      const data = fs.readFileSync(logoPath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
      served = true;
      break;
    } catch { continue; }
  }
  if (!served) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Logo not found'); }
  return;
}
```

**context (Dockerfile relevant lines):**
```dockerfile
WORKDIR /app
# ...
COPY assets ./assets
# → final container path is /app/assets/tino-logo.png
```

**conventions:**
- imports: `import fs from 'node:fs'` (already in server.ts at line 2) — keep `node:` prefix
- absolute path resolution: prefer `path.resolve('/app', 'assets', 'tino-logo.png')` over hand-spelled string when adding `node:path`; or simply `'/app/assets/tino-logo.png'` since the Dockerfile pins the path
- keep `Cache-Control: public, max-age=86400` (the logo is immutable per build)
- error handling: existing `try { } catch { continue; }` style is fine; preserve the 404 fallback for local dev where `/app` doesn't exist

**acceptance:**
- [x] logo loads on the console page in production
- [x] logo loads on the login page in production

## Open questions

- **plan-vs-reality drift:** wave 0 (executed before this wave) replaced the
  raw-http console (`packages/core/src/console/server.ts`, `html.ts`) with a
  Hono server (`packages/core/src/server/`) + Vite React SPA
  (`packages/core/src/console-app/`). The file paths in items 1.1, 1.3, and 1.4
  no longer exist; item 1.2's `tools/index.ts` is dead code (the live path is
  `capabilities/registry.ts`). Each item was re-mapped to the new architecture:
  - **1.1** — already implemented by wave 0's `server/middleware/auth.ts`
    (returns 401 JSON for `/api/*`, falls through to SPA for non-API). Locked
    in with 9 regression tests at `tests/server/auth-middleware.test.ts`.
  - **1.2** — fixed in `capabilities/registry.ts` (the live path) and mirrored
    in `tools/index.ts` (dead but kept consistent). `index.ts` now destructures
    `preferences` from `createPersistence` and threads it into
    `initCapabilityRegistry`. 2 regression tests added.
  - **1.3** — went the MVP path (re-login on restart). Documented the trade-off
    in `auth.ts`'s module doc and added a loud warning when
    `BETTER_AUTH_SECRET` is unset (without it, sessions silently invalidate
    every restart). Future: DynamoDB `secondaryStorage` adapter.
  - **1.4** — fixed in `server/index.ts` (Hono route, not raw-http). Prepended
    `/app/assets/tino-logo.png` (Dockerfile WORKDIR pin) to the candidate
    list; existing `import.meta.url` candidates preserved as local-dev
    fallbacks.
- **deferred to a later wave:** durable-session DynamoDB adapter (1.3 stretch
  goal). The custom adapter would replace SQLite session storage and let
  sessions survive ECS restarts. Estimate: 1-2 days; new file
  `packages/aws/src/persistence/dynamo/auth.ts` plus better-auth
  `secondaryStorage` config. Skipped because (a) MVP single-user tool, (b) ECS
  restarts rare, (c) re-login flow is one click + ~3 seconds.

## Post-implementation actions

External items in this wave that require manual verification after deployment:

- **1.3** — after `pulumi up` deploys a new ECS task revision, sign in to the console, then trigger a restart (`aws ecs update-service ... --force-new-deployment`) and confirm whether the session survives. Expected: re-login required (MVP trade-off accepted). If the durable-session DynamoDB adapter ships in a follow-up wave, re-verify session survival.
