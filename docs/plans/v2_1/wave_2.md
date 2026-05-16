# wave 2: make it configurable

the console can configure all capabilities. after this wave, a user can enable GitHub, Linear, Calendar, Gmail, and Slack reading entirely from the console — no code changes, no env vars.

## items

### 2.1 capability configuration UI in the console (gap #3)

**problem:** the console only shows the Slack setup + basics screens. there's no UI for configuring GitHub, Linear, Calendar, Gmail, Slack reading, or CloudWatch.

**fix:**
- the "full console" screen (after Slack + basics are configured) shows capability cards for each integration
- each card shows: name, description, status (connected / needs setup), and a "configure" button
- clicking "configure" expands the card to show credential inputs + settings
- capabilities to support:
  - **GitHub**: PAT input, default repo, repo allowlist
  - **Linear**: developer token input
  - **Google Calendar**: OAuth refresh token (or "connect with Google" button)
  - **Gmail**: shares Google OAuth, just needs to be enabled
  - **Slack reading**: user token (xoxp-) input
  - **CloudWatch**: log group allowlist (no credentials — uses the task role)

**files:**
- `packages/core/src/console/html.ts` (EDIT) — capability rendering inside `screen-console` (~lines 1206-1430) and the `getCapabilities()` / `putCapability()` helpers (~lines 1573-1587)
- (wave 0 may have moved this to React: `packages/core/src/console/pages/Console.tsx` + `components/CapabilityCard.tsx`. If wave 0 has shipped, mirror those files instead.)

**mirror:**
- `packages/core/src/console/html.ts` already has a `renderCapabilities()`-style block around line 1892 (`// Build fields for this capability`) that iterates capability configs — extend it to cover all six.
- the existing Slack-setup field pattern (lines 1589-1615 — `saveSlack` calling `putConfig('slack.botToken', ...)`) is the per-capability save mirror.
- backend route already in place: `PUT /api/capabilities/:id` at `packages/core/src/console/server.ts` lines 197-226.

**context (server.ts capability route ~lines 181-226):**
```ts
// GET /api/capabilities → list all capability.* config entries
// PUT /api/capabilities/:id → write capability.<id> = <body JSON>
if (method === 'GET' && routePath === '/api/capabilities') {
  void config.list().then(entries => {
    const caps = entries
      .filter(e => e.key.startsWith('capability.'))
      .map(e => { /* parse e.value */ return { id, config, updatedAt }; });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(caps));
  });
  return;
}
```

**context (html.ts existing capability render around line 1892):**
```js
// Build fields for this capability
// (iterates capability config entries and renders inputs)
```

**conventions:**
- config keys use lowercase dotted style (`github.token`, `linear.token`, `slack.userToken`, `cloudwatch.logGroups`); capability state uses `capability.<id>` JSON blob
- console JS: vanilla ES inside the HTML string. No build step. Pattern: `async function fooBar() { ... showToast('...', 'err') }`
- design tokens already declared (`--accent`, `--bg-raised`, etc. at lines 75-97) — re-use them, do NOT introduce new colors
- error handling: try/catch with `showToast(msg, 'err')` (defined in html.ts); never `alert()`
- if wave 0 (React migration) has landed, follow vitest + React Testing Library conventions inferred from `packages/core/tests/**/*.test.ts`

**acceptance:**
- [x] all 6 capability cards visible in the console
- [x] each card can be expanded to show configuration inputs
- [x] saving a capability's credentials writes to the config store
- [x] the capability status updates after saving (shows "connected" or "needs setup")

**post-wave-0 routing notes:**
- Live UI path: `packages/core/src/console-app/pages/Console.tsx` (renders capability grid via `getCapabilities()`) and `packages/core/src/console-app/components/CapabilityCard.tsx` (per-capability card; reads `cap.fields` to build inputs).
- Live API: `PUT /api/capabilities/:id` is in `packages/core/src/server/routes/capabilities.ts:37-52` (no change required for 2.1 — the route already accepts the full JSON blob and writes `capability.<id>`).
- mirror: `packages/core/src/console-app/components/CapabilityCard.tsx:83-98` (the existing per-field render loop) is the canonical mirror — the missing piece is the SOURCE of `cap.fields`. Today CapabilityCard expects `cap.fields` to come from the config-store JSON; nothing is seeding the field SCHEMAS for unconfigured capabilities. The fix is server-side: `createCapabilityRoutes` (`server/routes/capabilities.ts`) must merge a static schema from each `CapabilityModule` into the response so cards render even when `capability.<id>` is absent.
- context (capabilities/types.ts:32-56) — `CapabilityModule` interface; extend with an optional `fieldSchema?: CapField[]` (matching the `CapField` shape at `console-app/components/CapabilityCard.tsx:6-12`) so each capability declares its inputs in one place.
- conventions: ESM `.js` extensions; named exports; React function components only; design tokens via `styles/tokens.css` (`var(--accent)`, `var(--bg-raised)`, `var(--ok)`, `var(--err)`); never inline hex; vitest + `@testing-library/react` for tests.
- mocks: vitest `vi.fn()` to mock `getCapabilities`/`putCapability` from `console-app/lib/api.js`; render `<CapabilityCard cap={…} />` in jsdom via `@testing-library/react`. No real HTTP needed.

### 2.2 capability registration reads from config store (gap #1)

**problem:** `buildTools` in `src/tools/index.ts` reads credentials from env vars and hardcoded allowlists. in production, credentials are in the DynamoDB config store (written by the console). the tools don't register because the env vars are empty.

**fix:**
- `buildTools` reads each capability's credentials from the config store
- config keys follow the pattern: `github.token`, `github.defaultRepo`, `github.repos`, `linear.token`, `google.refreshToken`, `slack.userToken`, `cloudwatch.logGroups`
- fall back to env vars for backward compatibility (local dev with `.env`)

**files:**
- `packages/core/src/tools/github/client.ts` (EDIT) — read `github.token` from config; fall back to `env.GITHUB_TOKEN`
- `packages/core/src/tools/linear/client.ts` (EDIT) — read `linear.token` from config; fall back to `env.LINEAR_DEVELOPER_TOKEN`
- `packages/core/src/tools/google/oauth.ts` (EDIT) — read `google.refreshToken` from config
- `packages/core/src/slack/userClient.ts` (EDIT) — read `slack.userToken` from config
- `packages/core/src/tools/cloudwatch/allowlist.ts` (REFERENCE — already pulls from config)
- `packages/core/src/tools/index.ts` (EDIT) — pass `configStore` into each `create*` factory; the existing `buildTools(env, logger, taskStore?, configStore?)` signature is already in place

**mirror:**
- `packages/core/src/tools/github/allowlist.ts` is the canonical mirror — `getAllowedRepos(config)` and `getDefaultRepo(config)` already read from `ConfigStore` with env-var fallback. Extend the same pattern to credentials (token reads).
- the env-fallback pattern is in `packages/core/src/tools/index.ts` `resolveDefaultRepo` (lines 146-165): try config → fall back to env.

**context (tools/github/client.ts current ~all 18 lines):**
```ts
import { Octokit } from '@octokit/rest';
import type { Env } from '../../env.js';

export function createOctokit(env: Env): Octokit {
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set — GitHub tools are disabled');
  }
  return new Octokit({ auth: env.GITHUB_TOKEN, userAgent: 'tino/0.1' });
}
```

**context (tools/linear/client.ts current ~all 14 lines):**
```ts
import { LinearClient } from '@linear/sdk';
import type { Env } from '../../env.js';

export function createLinearClient(env: Env): LinearClient {
  if (!env.LINEAR_DEVELOPER_TOKEN) {
    throw new Error('LINEAR_DEVELOPER_TOKEN is not set — Linear tools are disabled');
  }
  return new LinearClient({ apiKey: env.LINEAR_DEVELOPER_TOKEN });
}
```

**context (tools/index.ts buildTools signature ~lines 41-66 & github block):**
```ts
export async function buildTools(
  env: Env, logger: AppLogger, taskStore?: TaskStore, configStore?: ConfigStore,
): Promise<ToolSet> {
  const tools: ToolSet = {};
  try {
    const octokit = createOctokit(env);                        // ← change to createOctokit(env, configStore)
    const allowedRepos = configStore ? await getAllowedRepos(configStore) : [];
    const defaultRepo = await resolveDefaultRepo(env, logger, configStore);
    tools['github_search_code'] = githubSearchCodeTool({ octokit, defaultRepo, allowedRepos });
    // ... etc
  } catch (err) { logger.warn({ err: (err as Error).message }, 'github tools disabled'); }
}
```

**context (canonical config-store-with-env-fallback pattern in `tools/github/allowlist.ts`):**
```ts
export async function getAllowedRepos(config: ConfigStore): Promise<RepoSpec[]> {
  const raw = await config.getTyped<string[]>('github.repos', []);
  return raw.flatMap(s => parseRepoSpec(s) ? [parseRepoSpec(s)!] : []);
}
```

**conventions:**
- config keys: lowercase dotted (`github.token`, `linear.token`, `google.refreshToken`, `slack.userToken`); be careful — wave 1.2 docs say `github.defaultRepo` while existing code uses `github.default_repo` (snake_case). Match existing key names; do NOT silently rename — that's a migration.
- config reads: `await configStore.getTyped<string | null>('foo.bar', null)` returning `null` when unset; the `JSON.parse` is handled by `getTyped`
- env fallback: try config first, then `env.<NAME>`; if both empty, `throw new Error('… is not set')` so `buildTools` catches and logs `<name> tools disabled`
- imports: ESM with `.js` extensions; `import type` for type-only imports
- test framework: vitest. New tests go in `packages/core/tests/tools/` mirroring `github.test.ts` style (`describe` + `it` + `vi.fn()` mocks)

**acceptance:**
- [x] after saving a GitHub PAT in the console and restarting, `github tools enabled` appears in logs
- [x] after saving a Linear token, `linear tools enabled` appears
- [x] all 22 tools register when all capabilities are configured
- [x] `toolCount: 22` (or close) in the startup logs

**post-wave-0 routing notes:**
- The live registration path is **`packages/core/src/capabilities/*.ts`** + `capabilities/registry.ts` — NOT `tools/index.ts`. `tools/index.ts` exists but is no longer called from `index.ts` (that file uses `initCapabilityRegistry` instead — see `index.ts:46-75`).
- Each capability module already reads from its `CapabilityConfig` (`config.credentials['token']`, `config.settings['repos']`, etc.) — see `packages/core/src/capabilities/github.ts:30-49`. The pattern is in place; the gap is the **migration helper** that moves env-var values into the right `capability.<id>` JSON blob shape.
- The relevant migration file is **`packages/core/src/capabilities/migration.ts`** (called once at startup from `index.ts:24`). That's the file 2.2 should extend, NOT `tools/github/client.ts` etc. (those are the underlying SDK wrappers and don't read config).
- mirror: `packages/core/src/capabilities/github.ts` is the canonical per-capability mirror. Apply the same `config.credentials[<key>]` / `config.settings[<key>]` pattern across `linear.ts`, `slack.ts`, `gmail.ts`, `calendar.ts`, `cloudwatch.ts` (most are already done — verify each).

**context (capabilities/types.ts CapabilityConfig shape):**
```ts
export interface CapabilityConfig {
  enabled: boolean;
  credentials: Record<string, string>;   // tokens, API keys
  settings: Record<string, unknown>;     // allowlists, defaults
  findWork?: { enabled: boolean; intervalMinutes: number; lastScanAt?: number };
}
```

**context (capabilities/github.ts current ~lines 24-55, the live path):**
```ts
async registerTools(config: CapabilityConfig, _configStore, logger, tools): Promise<void> {
  const token = config.credentials['token'];
  if (!token) throw new Error('GitHub capability: credentials.token is not set');
  const octokit = new Octokit({ auth: token, userAgent: 'tino/0.1' });
  const reposRaw = (config.settings['repos'] as string[] | undefined) ?? [];
  const allowedRepos: RepoSpec[] = reposRaw.flatMap(s => parseRepoSpec(s) ? [parseRepoSpec(s)!] : []);
  // … register tools …
}
```

**context (capabilities/migration.ts purpose):**
- Called once at startup from `index.ts:24`. Reads env vars (GITHUB_TOKEN, LINEAR_DEVELOPER_TOKEN, etc.) and writes them into `capability.<id>` JSON blobs IF the blob is missing. Idempotent — re-runs are no-ops.
- Extension point for 2.2: ensure migration covers all 6 capabilities and writes the right `credentials` + `settings` keys.

**conventions:**
- live config keys: `capability.<id>` is a JSON blob with `{ enabled, credentials, settings }` — do NOT introduce flat `<id>.token` keys (that's the dead `tools/index.ts` shape). New code reads `config.credentials.token`, not `configStore.get('github.token')`.
- imports: ESM `.js` extensions; `import type` for type-only
- error handling: each capability's `registerTools` throws a descriptive Error; `registry.ts:101-109` catches it and logs `<displayName> tools disabled` with the message — preserve this contract
- tests: vitest at `packages/core/tests/capabilities/<id>.test.ts` (none exist today for capability modules — `tests/tools/preferences.test.ts` is the closest mirror for tool-level testing)

**mocks:**
- `Octokit`: `vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))` — assert constructor called with the right `auth` token
- `LinearClient`, `google-auth-library`, `@aws-sdk/client-cloudwatch-logs`: same mock-the-module pattern
- `ConfigStore`: in-memory test double (a `Map<string, string>` with `get`/`set`/`list`/`delete` matching the `ConfigStore` interface) — preferred over mocking `better-sqlite3`

### 2.3 validate bedrock model ID (gap #15)

**problem:** if the model ID saved in the config store is wrong (typo, model not available), tino crashes on the first message with an opaque Bedrock error.

**fix:**
- on startup, after reading `bedrock.modelId` from config, make a lightweight Bedrock call to verify the model is accessible (e.g., `InvokeModel` with a tiny prompt, or `ListInferenceProfiles` to check the ID exists)
- if validation fails, log a clear error and fall back to the default model ID
- the console should also validate the model ID when saving (call the Bedrock API from the server)

**files:**
- `packages/core/src/agent/bedrock.ts` (EDIT) — add `validateBedrockModel(modelId, region): Promise<{ ok: true } | { ok: false; error: string }>`
- `packages/core/src/index.ts` (EDIT) — after reading `bedrock.modelId` (~lines 39-43), call validator and fall back to `DEFAULT_BEDROCK_MODEL_ID` on failure
- `packages/core/src/console/server.ts` (EDIT) — new route `POST /api/validate/bedrock` (or extend `PUT /api/config/bedrock.modelId` to validate before writing)

**mirror:**
- the credential-fallback shape in `packages/core/src/index.ts` (lines 32-43, where `parseConfigValue` falls back from config to env) is the same "try → fallback" pattern.
- there is no existing AWS SDK validation call in the codebase to mirror — closest is `createCloudWatchLogsClient` in `packages/core/src/tools/cloudwatch/client.ts` for the SDK setup pattern.

**context (current bedrock.ts):**
```ts
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { LanguageModel } from 'ai';

export const DEFAULT_BEDROCK_MODEL_ID = 'global.anthropic.claude-sonnet-4-6';

export function createBedrockModel(modelId: string, region?: string): LanguageModel {
  const bedrock = createAmazonBedrock({ region, credentialProvider: fromNodeProviderChain() });
  return bedrock(modelId);
}
```

**context (index.ts current Bedrock startup ~lines 39-43):**
```ts
const bedrockModelId = await configStore.getTyped<string>(
  'bedrock.modelId',
  DEFAULT_BEDROCK_MODEL_ID,
);
const model = createBedrockModel(bedrockModelId, env.AWS_REGION);
```

**conventions:**
- imports: ESM with `.js` extensions
- AWS SDK clients: use `@aws-sdk/credential-providers` `fromNodeProviderChain()` and pass `region` from `env.AWS_REGION` (already the convention)
- exports: named `export function`; do NOT export the validator as default
- error logs: `logger.error({ modelId, err: (err as Error).message }, 'bedrock model validation failed — falling back to default')`
- tests: vitest; mock the Bedrock client per `packages/core/tests/tools/calendar.test.ts` mocking style
- avoid `InvokeModel` for validation if possible (charges + latency on every startup); prefer `bedrock-runtime` `Converse` with a 1-token prompt or `bedrock` control-plane `ListInferenceProfiles` for cheap existence checks

**acceptance:**
- [x] invalid model ID → clear error log, tino still starts (falls back to default)
- [x] valid model ID → tino uses it, no error

**post-wave-0 routing notes:**
- The validate-on-save route should land in `packages/core/src/server/routes/` as a NEW file (e.g. `bedrock.ts`) wired into `server/index.ts:117-123` via `app.route('/api/bedrock', createBedrockRoutes({ logger }))` — match the existing `createConfigRoutes`/`createCapabilityRoutes` factory shape. The plan's reference to `console/server.ts` is the legacy path.
- Startup-time validation belongs at `packages/core/src/index.ts:39-43` (where `bedrock.modelId` is read).

**context (server/routes/config.ts factory shape, the mirror for the new bedrock route ~lines 17-23):**
```ts
export function createConfigRoutes(opts: {
  config: ConfigStore;
  logger: AppLogger;
  auditLogger: AuditLogger | undefined;
}): Hono {
  const app = new Hono();
  // …
  return app;
}
```

**conventions:**
- imports: ESM `.js` extensions; named imports
- AWS SDK clients: use `@aws-sdk/credential-providers` `fromNodeProviderChain()` and pass `region` from `env.AWS_REGION`
- exports: named `export function`; do NOT export the validator as default
- error logs: `logger.error({ modelId, err: (err as Error).message }, 'bedrock model validation failed — falling back to default')`
- tests: vitest; mock the Bedrock client per `packages/core/tests/tools/calendar.test.ts` mocking style — `vi.mock('@aws-sdk/client-bedrock-runtime', …)` and assert success/failure paths
- avoid `InvokeModel` for validation (per-startup charges); prefer `bedrock-runtime` `Converse` with a 1-token prompt or `bedrock` control-plane `ListInferenceProfiles` for cheap existence checks

**mocks:**
- `@aws-sdk/client-bedrock-runtime` (or `@aws-sdk/client-bedrock`): `vi.mock(...)` returning a stub `send` that resolves for valid IDs and rejects with a `ValidationException`-shaped error for invalid IDs
- `fromNodeProviderChain`: stub to return a static credential object — never call real AWS during tests
- `AppLogger`: `{ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }` so we can assert the fallback log line

### 2.4 console shows active capabilities (gap #11)

**problem:** the console doesn't show which capabilities are currently active (tools registered) vs which need setup.

**fix:**
- the `/api/health` endpoint already returns `tools` (list of registered tool names)
- the console reads this and maps tool names to capabilities
- each capability card shows a green dot if its tools are registered, red if not

**files:**
- `packages/core/src/console/html.ts` (EDIT) — capability card rendering inside `screen-console` (~lines 1206-1430); `getHealth()` helper at lines 1560-1565 already returns `tools` array
- `packages/core/src/console/server.ts` (REFERENCE) — `GET /api/health` already exposes `tools: Object.keys(tools)` at lines 83-99; no backend change needed

**mirror:**
- the existing capability iteration block at `html.ts:~1892` (`// Build fields for this capability`) is the per-card render mirror — extend it to compute a `connected` flag from the `tools` health array.
- design tokens already include `--ok: #6aab7a` and `--err: #c06060` (lines 88-89) for the status dot; reuse them.

**context (server.ts /api/health response shape ~lines 83-99):**
```ts
const body = JSON.stringify({
  ok: true,
  tools: Object.keys(tools),                    // e.g. ['github_search_code', 'linear_search_issues', ...]
  uptime: (Date.now() - startTime) / 1000,
  capabilities: Object.entries(capState).map(([id, s]) => ({
    id, toolCount: s.toolCount, lastFindWorkScanAt: s.lastFindWorkScanAt, lastError: s.lastError,
  })),
});
```

**context (html.ts getHealth ~lines 1560-1565):**
```js
async function getHealth() {
  const r = await fetch('/api/health');
  if (r.status === 401) { window.location.reload(); return {}; }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
```

**capability → tool-name prefix mapping (derived from `packages/core/src/tools/index.ts`):**
- `github` → tool names start with `github_*`
- `linear` → tool names start with `linear_*`
- `google` (calendar+gmail) → `calendar_*`, `gmail_*`
- `slack` (reading) → `slack_*`
- `cloudwatch` → `cloudwatch_logs_query`
- `preferences` → `set_preference`, `get_preferences`

**conventions:**
- console JS: vanilla ES; `async/await`; no library
- DOM updates: existing pattern is `document.getElementById(id).textContent = ...` — keep that style
- design tokens: use CSS custom properties from `:root` block (`var(--ok)`, `var(--err)`); never inline hex
- polling: avoid setInterval for now — refresh on page load and after each capability save (the existing pattern after `saveSlack`)

**acceptance:**
- [x] capability cards show green/red status based on actual tool registration
- [x] status updates after page refresh (or via polling)

**post-wave-0 routing notes:**
- Live UI: `packages/core/src/console-app/components/CapabilityCard.tsx` (not `html.ts`). The card currently hardcodes its status from `enabled` (`CapabilityCard.tsx:121-125`); 2.4 changes that to a derived flag based on whether ANY of the capability's expected tool prefixes appear in the live `/api/health` `tools` array.
- Health hook: `packages/core/src/console-app/hooks/useHealth.ts` already polls `/api/health` and is consumed by `Console.tsx:40` — pass the resulting `tools: string[]` down into each `<CapabilityCard>` (or via a context/prop).
- Backend: `packages/core/src/server/routes/health.ts:18-30` already returns `tools: Object.keys(opts.tools)` and per-capability state (toolCount, lastError) — no backend change required.

**context (server/routes/health.ts response shape ~lines 18-30):**
```ts
app.get('/', (c) => {
  const capState = opts.registry?.getState() ?? {};
  return c.json({
    ok: true,
    tools: Object.keys(opts.tools),
    uptime: (Date.now() - opts.startTime) / 1000,
    capabilities: Object.entries(capState).map(([id, s]) => ({
      id, toolCount: s.toolCount, lastFindWorkScanAt: s.lastFindWorkScanAt, lastError: s.lastError,
    })),
  });
});
```

**context (CapabilityCard.tsx current status render ~lines 120-126):**
```tsx
<div className="cap-card-status">
  {enabled ? (
    <span className="status-connected">● on</span>
  ) : (
    <span style={{ fontSize: '0.714rem', color: 'var(--text-dim)' }}>off</span>
  )}
</div>
```

**capability → tool-name prefix mapping (canonical, derived from `capabilities/*.ts` registerTools):**
- `github` → `github_*`
- `linear` → `linear_*`
- `gmail` → `gmail_*`
- `calendar` → `calendar_*`
- `slack` → `slack_search_messages`, `slack_read_thread`, `slack_list_dms`, `slack_read_dm`
- `cloudwatch` → `cloudwatch_logs_query`

Define this mapping in a NEW file `packages/core/src/console-app/lib/capabilityTools.ts` so React components and (future) tests share one source of truth.

**conventions:**
- React: function components only; pass `tools: string[]` as a prop to CapabilityCard rather than calling `useHealth()` inside the card (keeps the card stateless / easier to test)
- design tokens: reuse `--ok` / `--err` from `styles/tokens.css`; never inline hex
- naming: keep CSS class `status-connected` for the "on" state — it's already styled
- tests: vitest + `@testing-library/react`; render `<CapabilityCard cap={…} tools={['github_search_code']} />` and assert the dot color/class

**mocks:**
- no external services here — everything is React state + a derived array. Tests need NO mocks beyond the standard `@testing-library/react` jsdom setup.

### 2.5 console "signed in as" indicator (gap #19)

**problem:** the console should show who's logged in and provide a sign-out link.

**fix:**
- the auth middleware passes the session user info to the HTML template
- or: the console JS calls `/api/auth/get-session` to get the current user
- display email + sign-out link in the console header

**files:**
- `packages/core/src/console/html.ts` (EDIT) — header in `screen-console` (~lines 1206-1230); existing sign-out button at line 1222 (`onclick="signOut()"`) and `signOut()` function at line 2061; the email span needs wiring
- `packages/core/src/console/server.ts` (REFERENCE) — better-auth `/api/auth/*` is mounted via `authHandler` (line 372); `get-session` is supported out of the box. No new route required.

**mirror:**
- existing `signOut()` at `html.ts:~2061` is the API-call mirror:
  ```js
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
  ```
  Apply the same shape to a new `getSession()` helper hitting `/api/auth/get-session`.
- the header CSS (`.header-signout` at ~line 967) is the existing styling target; place the email span next to it using the same `.header-*` naming convention.

**context (html.ts header markup ~lines 1206-1230):**
```html
<div id="screen-console" class="screen">
  <header class="console-header">
    <div class="header-brand">
      <img src="/assets/tino-logo.png" alt="tino" class="header-logo">
      ...
    </div>
    <div class="header-actions">
      <!-- TODO: <span class="header-email" id="header-email"></span> -->
      <button class="header-signout" onclick="signOut()" type="button">sign out</button>
    </div>
  </header>
```

**context (html.ts current signOut ~lines 2061-2065):**
```js
async function signOut() {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    window.location.reload();
  } catch (err) { /* ... */ }
}
```

**better-auth API:**
- `GET /api/auth/get-session` returns `{ session: { ... }, user: { id, email, name, image, ... } }` or `null` when unauthenticated
- the existing `authMiddleware` in `server.ts` (lines 382-385) already calls `auth.api.getSession({ headers: ... })` server-side — no extra plumbing needed

**conventions:**
- console JS: vanilla ES; `fetch` with `credentials: 'include'`
- DOM: `document.getElementById('header-email').textContent = data.user.email` — match existing `.textContent` style
- design tokens: header colors use `var(--text-sec)` for secondary text; do not introduce new colors
- privacy: never log the user's email at info level — use `logger.debug` if needed; avoid putting `email` into URL query strings
- error handling: silently degrade if `get-session` fails (hide the email span) rather than blocking the page

**acceptance:**
- [x] console header shows the logged-in user's email — implemented at `packages/core/src/console-app/components/Header.tsx:35-43` (renders `session.user.email` when present)
- [x] "sign out" link works and redirects to the login page — implemented at `Header.tsx:39-41` calling `useAuth().signOut()` (which hits `/api/auth/sign-out` per `console-app/lib/api.ts:119-125`)

**post-wave-0 routing notes:**
- Item 2.5 was effectively delivered by wave 0's React migration. `Header.tsx` already shows the email + sign-out; `useAuth.ts` already wraps `getSession()`/`signOut()` from `lib/api.ts`. No further work required.

## Open questions

(Decisions made during execution — no blockers, recorded for review.)

- **Bedrock validation strategy:** chose to call `generateText` with `maxOutputTokens: 1` through the already-installed `@ai-sdk/amazon-bedrock` wrapper rather than adding `@aws-sdk/client-bedrock-runtime` for a `Converse` call or `@aws-sdk/client-bedrock` for `ListInferenceProfiles`. Trade-off: at most 1 output token of cost per startup vs avoiding a new dependency. Revisit if startup cost becomes measurable.
- **Capability fields shape:** introduced `CapField.target` (dotted path like `credentials.token`, `settings.repos`) and `kind: 'string' | 'string[]'` so the GET/PUT round-trip is unambiguous. The server reconstructs the live `CapabilityConfig` shape on save; the console never sees the raw blob.
- **Slack runtime tokens migration:** the existing `migrateEnvToCapabilities` only wrote a `slack.connection` JSON blob, but `index.ts` reads flat `slack.botToken` / `slack.appToken` / `slack.adminUserId` keys. Added explicit migration of the flat keys (preserving the legacy blob for back-compat).
- **No React Testing Library tests added:** `@testing-library/react` and `jsdom` are not installed in `packages/core`. Added unit tests for the schema helpers (`tests/capabilities/schema.test.ts`) which covers the round-trip logic without UI rendering. Adding RTL is out of scope for this wave.
- **`CapabilityCard.tsx` no longer accepts arbitrary extra keys** (the old `[key: string]: unknown` index signature). The new shape is strictly `{ id, displayName?, enabled?, fields?, connected? }`. The `connected` flag is derived in `Console.tsx` from `/api/health.tools`.
