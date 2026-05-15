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
- [ ] all 6 capability cards visible in the console
- [ ] each card can be expanded to show configuration inputs
- [ ] saving a capability's credentials writes to the config store
- [ ] the capability status updates after saving (shows "connected" or "needs setup")

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
- [ ] after saving a GitHub PAT in the console and restarting, `github tools enabled` appears in logs
- [ ] after saving a Linear token, `linear tools enabled` appears
- [ ] all 22 tools register when all capabilities are configured
- [ ] `toolCount: 22` (or close) in the startup logs

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
- [ ] invalid model ID → clear error log, tino still starts (falls back to default)
- [ ] valid model ID → tino uses it, no error

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
- [ ] capability cards show green/red status based on actual tool registration
- [ ] status updates after page refresh (or via polling)

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
- [ ] console header shows the logged-in user's email
- [ ] "sign out" link works and redirects to the login page
