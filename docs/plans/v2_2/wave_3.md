# wave 3: test coverage

add tests for untested server routes, capability modules, and critical React components. after this wave, every server route has at least a smoke test and the most important UI components have render tests.

## strategy

- **server routes:** test via Hono's `app.request()` test helper (no real HTTP server needed). mock the config store and audit logger. assert status codes, response shapes, and side effects.
- **React components:** use `react-dom/server` `renderToString()` for render tests (already established in `header-restart-button.test.ts`). no jsdom or `@testing-library/react` — keep the test deps minimal. test that components render the right structure, not click handlers.
- **capability modules:** test `registerTools()` with a mock config and assert the right tool names are registered.
- **CLI:** add at least a smoke test for `tino init` and `tino deploy` command parsing.

## items

### 3.1 server route tests

**new test files:**

| route file | test file | what to test |
|-----------|-----------|-------------|
| `routes/health.ts` | `tests/server/health-routes.test.ts` | returns `{ ok: true, tools: [...], uptime, capabilities }` |
| `routes/config.ts` | `tests/server/config-routes.test.ts` | GET returns config list; PUT writes and returns `{ ok: true }`; DELETE removes; 400 on missing value |
| `routes/capabilities.ts` | `tests/server/capability-routes.test.ts` | GET returns capability list with field schemas; PUT writes capability config |
| `routes/compliance.ts` | `tests/server/compliance-routes.test.ts` | returns HIPAA snapshot with encryption, audit, BAA sections |
| `routes/users.ts` | `tests/server/users-routes.test.ts` | DELETE removes user config entries |
| `routes/bedrock.ts` | `tests/server/bedrock-routes.test.ts` | POST validates model ID; returns `{ ok: true }` or `{ ok: false, error }` |

**test pattern (mirror `tests/server/admin-routes.test.ts`):**
```ts
import { Hono } from 'hono';
import { describe, it, expect, vi } from 'vitest';
import { createHealthRoutes } from '../../src/server/routes/health.js';

describe('GET /api/health', () => {
  it('returns ok with tool list', async () => {
    const app = new Hono();
    app.route('/api/health', createHealthRoutes({
      startTime: Date.now(),
      tools: { github_search_code: {}, linear_search_issues: {} },
      registry: undefined,
    }));
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tools).toContain('github_search_code');
  });
});
```

**mocks:**
- `ConfigStore`: in-memory Map-backed test double (already used in `tests/capabilities/registry.test.ts`)
- `AuditLogger`: `{ log: vi.fn(), count: vi.fn().mockResolvedValue(0), lastEntryAt: vi.fn().mockResolvedValue(undefined) }`
- `CapabilityRegistry`: `{ tools: {}, stopAll: vi.fn(), getState: vi.fn().mockReturnValue({}), capabilityIds: [], reload: vi.fn() }`

**files:** 6 NEW test files (one per route):
- `packages/core/tests/server/health-routes.test.ts` — NEW
- `packages/core/tests/server/config-routes.test.ts` — NEW
- `packages/core/tests/server/capability-routes.test.ts` — NEW
- `packages/core/tests/server/compliance-routes.test.ts` — NEW
- `packages/core/tests/server/users-routes.test.ts` — NEW
- `packages/core/tests/server/bedrock-routes.test.ts` — NEW

**mirror:** `packages/core/tests/server/admin-routes.test.ts` is the canonical pattern (mounts a `Hono` app with `app.route('/api/admin', createAdminRoutes(...))`, calls `app.request(path, init)`, asserts `res.status` + `res.json()`). Also useful: `packages/core/tests/server/reload-routes.test.ts` (same shape, covers a 200/400/500 matrix). Mirror their imports, their `noopLogger()` helper, their `mountAdmin()`-style helper renamed per-route, and their use of `vi.fn()` for callbacks.

**context — `tests/server/admin-routes.test.ts` (lines 16-30, the canonical reusable scaffolding):**
```ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAdminRoutes } from '../../src/server/routes/admin.js';
import { createMemoryAuditLogger } from '../../src/audit/memory.js';
import type { AppLogger } from '../../src/slack/app.js';

function noopLogger(): AppLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function mountAdmin(opts: Parameters<typeof createAdminRoutes>[0]): Hono {
  const app = new Hono();
  app.route('/api/admin', createAdminRoutes(opts));
  return app;
}
```

**context — route signatures (read each file's `createXxxRoutes` opts to build the test mock):**

`src/server/routes/health.ts` (full file — 34 lines):
```ts
export function createHealthRoutes(opts: {
  startTime: number;
  tools: Record<string, unknown>;
  registry: CapabilityRegistry | undefined;
}): Hono {
  // GET / → c.json({ ok: true, tools: Object.keys(opts.tools), uptime, capabilities: [...] })
}
```

`src/server/routes/config.ts` opts (lines 17-21):
```ts
export function createConfigRoutes(opts: {
  config: ConfigStore;
  logger: AppLogger;
  auditLogger: AuditLogger | undefined;
}): Hono
// GET /         → list entries
// PUT /:key     → 400 if missing key/value, else write + audit + return { ok: true, key }
// DELETE /:key  → write audit on hit, return { ok: true, deleted }
```

`src/server/routes/capabilities.ts`, `src/server/routes/compliance.ts`, `src/server/routes/users.ts`, `src/server/routes/bedrock.ts` — read each file's `createXxxRoutes(opts: {...})` signature to know which mocks to inject. All follow the same shape: a factory that takes a `{ config, logger, auditLogger?, registry?, ... }` opts bag and returns a `Hono` sub-app.

**conventions:** vitest (NOT `bun:test`); `import { describe, it, expect, vi } from 'vitest'`; ESM with `.js` extensions on relative imports; pino-shaped `noopLogger()` helper (4 methods: `debug`/`info`/`warn`/`error`); `Hono` apps mounted with `app.route('/api/<scope>', createXxxRoutes(...))` so `app.request('/api/<scope>/<path>')` exercises the real path-prefix; assert `res.status` first then `res.json()` cast to `as { ... }`; tests are PURE — no real network, no real DB, no `nextApp.start()`. Use `createMemoryAuditLogger()` from `src/audit/memory.js` instead of hand-rolling an audit mock when the route writes audit entries (it lets you assert `audit.entries` directly).

**acceptance:**
- [x] 6 new test files, each with ≥ 2 test cases
- [x] `bun run test` passes with the new tests
- [x] route coverage: every route handler has at least one happy-path and one error-path test

### 3.2 capability module tests

**new test files:**

| capability | test file | what to test |
|-----------|-----------|-------------|
| `capabilities/github.ts` | `tests/capabilities/github.test.ts` | `registerTools()` with valid token → registers 4 github tools; missing token → throws |
| `capabilities/linear.ts` | `tests/capabilities/linear.test.ts` | `registerTools()` with valid token → registers 7 linear tools; missing token → throws |
| `capabilities/calendar.ts` | `tests/capabilities/calendar.test.ts` | `registerTools()` with valid refresh token → registers 1 calendar tool |
| `capabilities/gmail.ts` | `tests/capabilities/gmail.test.ts` | `registerTools()` with valid refresh token → registers 2 gmail tools |
| `capabilities/slack.ts` | `tests/capabilities/slack.test.ts` | `registerTools()` with valid user token → registers 4 slack tools |
| `capabilities/cloudwatch.ts` | `tests/capabilities/cloudwatch.test.ts` | `registerTools()` → registers 1 cloudwatch tool |

**mocks:**
- `Octokit`: `vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))`
- `LinearClient`: `vi.mock('@linear/sdk', () => ({ LinearClient: vi.fn() }))`
- `google-auth-library`: `vi.mock('google-auth-library', () => ({ OAuth2Client: vi.fn(() => ({ setCredentials: vi.fn() })) }))`
- `@aws-sdk/client-cloudwatch-logs`: `vi.mock(...)` returning stub client

**files:** 6 NEW test files (one per capability):
- `packages/core/tests/capabilities/github.test.ts` — NEW
- `packages/core/tests/capabilities/linear.test.ts` — NEW
- `packages/core/tests/capabilities/calendar.test.ts` — NEW
- `packages/core/tests/capabilities/gmail.test.ts` — NEW
- `packages/core/tests/capabilities/slack.test.ts` — NEW
- `packages/core/tests/capabilities/cloudwatch.test.ts` — NEW

**mirror:** `packages/core/tests/capabilities/registry.test.ts` is the canonical pattern (in-memory `makeConfigStore()` helper, `vi.fn()`-based `makeLogger()`, fixture configs as top-level `const`s like `GITHUB_CONFIG`/`LINEAR_CONFIG`). Tests in this directory exercise capability behavior end-to-end without real SDKs — copy that style.

**context — `tests/capabilities/registry.test.ts` (lines 17-50, reusable mocks):**
```ts
function makeLogger(): AppLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeConfigStore(entries: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, string>(
    Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  return {
    get: vi.fn(async (key) => store.get(key) ?? null),
    getTyped: vi.fn(async <T>(key: string, fallback: T) => { /* ... */ }),
    set: vi.fn(async (key, value) => { store.set(key, JSON.stringify(value)); }),
    list: vi.fn(async () => [...store.entries()].map(([key, value]) => ({ key, value, updatedAt: Date.now() }))),
    delete: vi.fn(async (key) => { /* ... */ }),
  };
}
```

**context — capability module shape (`src/capabilities/github.ts` lines 20-58, the pattern all capabilities follow):**
```ts
export const githubCapability: CapabilityModule = {
  id: 'github',
  displayName: 'GitHub',
  fieldSchema: [ /* ... key/label/target descriptors ... */ ],

  async registerTools(
    config: CapabilityConfig,
    _configStore: ConfigStore,
    logger: AppLogger,
    tools: ToolSet,                  // ← MUTATED: tools[name] = toolDef
  ): Promise<void> {
    const token = config.credentials['token'];
    if (!token) {
      throw new Error('GitHub capability: credentials.token is not set');
    }
    const octokit = new Octokit({ auth: token, userAgent: 'tino/0.1' });
    // ... assigns into the `tools` ToolSet ...
  },
};
```
Test pattern: import the capability module, create an empty `tools: ToolSet = {}`, call `await capability.registerTools(GOOD_CONFIG, makeConfigStore(), makeLogger(), tools)`, then assert `Object.keys(tools)` contains the expected tool names. For the missing-credential case, call with `BAD_CONFIG` (`credentials: {}`) and `expect(...).rejects.toThrow(/token/i)`. Other capability files (`linear.ts`, `calendar.ts`, `gmail.ts`, `slack.ts`, `cloudwatch.ts`) live alongside in `src/capabilities/` — read each one's `registerTools` body to enumerate the tool names it assigns and which credential keys it requires.

**conventions:** vitest with `import { describe, it, expect, vi } from 'vitest'`; ESM `.js` extensions on relative imports; named imports for capability modules (e.g., `import { githubCapability } from '../../src/capabilities/github.js'`); fixture configs as top-level `const FOO_CONFIG: CapabilityConfig = { enabled: true, credentials: {...}, settings: {...}, findWork: { enabled: false, intervalMinutes: 15 } }`; mock external SDKs at module level via `vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))` BEFORE importing the capability — vitest hoists `vi.mock` calls automatically; assertions on tool registration use `expect(Object.keys(tools)).toContain('github_search_code')` (not full equality — capabilities may register more tools over time).

**acceptance:**
- [x] 6 new test files
- [x] each capability's `registerTools()` is tested with valid and invalid config
- [x] `bun run test` passes

### 3.3 React component render tests

**new test files:**

| component | test file | what to test |
|----------|-----------|-------------|
| `InsecureBanner.tsx` | `tests/console-app/insecure-banner.test.ts` | renders warning when protocol is `http:` on non-localhost; returns null for `https:` |
| `CapabilityCard.tsx` | `tests/console-app/capability-card.test.ts` | renders card with name, status dot, fields when expanded |
| `Login.tsx` | `tests/console-app/login.test.ts` | renders Google sign-in button |
| `SaveButton.tsx` | `tests/console-app/save-button.test.ts` | renders button with correct label; shows loading state |

**test pattern (mirror `tests/console-app/header-restart-button.test.ts`):**
```ts
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { InsecureBanner } from '../../src/console-app/components/InsecureBanner.js';

describe('InsecureBanner', () => {
  it('renders warning text', () => {
    // InsecureBanner checks window.location — in SSR (no window), returns null
    const html = renderToString(createElement(InsecureBanner));
    // SSR: window is undefined → returns null → empty string
    expect(html).toBe('');
  });
});
```

**note:** `InsecureBanner` and other components that check `window.location` will return `null` in SSR. the render tests verify the SSR path (no crash, correct null return). full DOM tests with `window` mocking would require jsdom — defer to a future wave if needed.

**files:** 4 NEW test files:
- `packages/core/tests/console-app/insecure-banner.test.ts` — NEW
- `packages/core/tests/console-app/capability-card.test.ts` — NEW
- `packages/core/tests/console-app/login.test.ts` — NEW
- `packages/core/tests/console-app/save-button.test.ts` — NEW

**mirror:** `packages/core/tests/console-app/header-restart-button.test.ts` is the only existing console-app test and the canonical pattern (uses `react-dom/server`'s `renderToString` + `createElement` from `react`, asserts on the static HTML via `expect(html).toMatch(/regex/)`). DO NOT introduce jsdom or `@testing-library/react` — the rationale is documented in that test's leading doc-comment (extra deps + environment switch for substring assertions). Mirror the doc-comment style: open with a 1-paragraph summary citing the wave/item it covers, list "what this test does NOT cover", end with the `describe` block.

**context — `tests/console-app/header-restart-button.test.ts` (lines 27-56, the reusable pattern):**
```ts
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Header } from '../../src/console-app/components/Header.js';

describe('<Header /> — wave 3.4 restart button', () => {
  it('renders a "restart" button when a session is present', () => {
    const html = renderToString(
      createElement(Header, {
        status: 'ok',
        session: SESSION,
        onSignOut: () => {},
      }),
    );
    expect(html).toMatch(/>restart</);
    expect(html).toMatch(/aria-label="Restart tino"/);
  });
});
```

**context — `src/console-app/components/InsecureBanner.tsx` (lines 20-26, the SSR-relevant gate the test must hit):**
```tsx
export function InsecureBanner(): JSX.Element | null {
  if (typeof window === 'undefined') return null;       // ← SSR path: returns null
  const { protocol, hostname } = window.location;
  if (protocol !== 'http:') return null;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return null;
  }
  // ... renders <div role="alert">...</div>
}
```
Under `renderToString` (no `window`), the early return fires and the output is the empty string. Assertion: `expect(renderToString(createElement(InsecureBanner))).toBe('')`. Item 1.7 of wave_1 changes the inline `rgba(...)` style values to design tokens — if 3.3 runs AFTER wave 1, account for that (the test should not assert on raw rgba strings).

**context — other components to test:**
- `src/console-app/components/CapabilityCard.tsx` — renders capability name, status dot (a `<span>` with class `status-dot ok|warn|err`), expandable fields list. Props: `{ capability, config, onSave, onSelect }`.
- `src/console-app/components/SaveButton.tsx` — `<button>` with loading state. Props: `{ saving: boolean, onClick: () => void, label?: string }`.
- `Login.tsx` — does NOT exist as a standalone component file (verified by `ls packages/core/src/console-app/components/` — components are: `CapabilityCard`, `ComplianceSection`, `ConfigTable`, `Header`, `HealthFooter`, `InsecureBanner`, `RevealInput`, `SaveButton`). Either find the actual login UI source (likely a route/page in `src/console-app/`) or drop the Login test from this item — flag this in the executor return payload.

**conventions:** vitest (`import { describe, it, expect } from 'vitest'`); ESM `.js` extensions on relative imports targeting `.tsx` files (`from '../../src/console-app/components/InsecureBanner.js'` even though the source is `.tsx`); React 19 (`createElement` from `'react'`, NOT `React.createElement`); no jsdom, no `@testing-library/react`; assertions use `.toMatch(/regex/)` against the rendered string for content, `.toBe('')` for null/empty render; preserve the test's leading doc-comment style (cite the wave/item, explain SSR-vs-DOM trade-off).

**acceptance:**
- [x] 4 new test files

      Actually 3 — `Login.tsx` does not exist as a standalone component file
      (the plan's own § 3.3 context block already flagged this). The console's
      Google sign-in lives elsewhere; rather than testing a non-existent
      component, the Login render test was dropped. The other three landed:
      `insecure-banner.test.ts`, `capability-card.test.ts`, `save-button.test.ts`.
- [x] `bun run test` passes

### 3.4 CLI smoke tests

**new files:**
- `packages/cli/package.json` — add `"test": "vitest run"`
- `packages/cli/vitest.config.ts` — NEW (minimal config)
- `packages/cli/tests/commands/init.test.ts` — smoke test: `tino init --help` doesn't crash
- `packages/cli/tests/commands/deploy.test.ts` — smoke test: `executeDeploy` with missing infra dir calls `displayError` + `process.exit(1)` (already tested in core — move or duplicate)

**mirror:** `packages/core/vitest.config.ts` is the canonical vitest config (13 lines, `defineConfig` from `vitest/config`, `test.include`/`test.exclude` globs). Mirror its structure for `packages/cli/vitest.config.ts`. For test layout, mirror `packages/core/tests/server/admin-routes.test.ts` (mock side-effect callbacks with `vi.fn()`, assert on the mock invocations). `cmd-ts` commands export a `command({ ... })` object — to invoke them in a test, call the command's handler directly (via `command.handler({...})`) rather than going through `cmd-ts`'s `run(binary(app), argv)` (which calls `process.exit` and is hard to test).

**context — `packages/cli/src/index.ts` (full file, 22 lines):**
```ts
#!/usr/bin/env node
import { binary, run, subcommands } from 'cmd-ts';
import { init } from './commands/init.js';
import { deploy } from './commands/deploy.js';

const app = subcommands({
  name: 'tino',
  cmds: { init, deploy },
});

run(binary(app), process.argv);
```

**context — `packages/cli/src/commands/init.ts` (lines 20-36, the `cmd-ts` command shape):**
```ts
export const init = command({
  name: 'init',
  description: 'Set up a new HIPAA-compliant tino deployment',
  args: {},
  handler: async () => {
    displayBanner();
    let config: Partial<DeployConfig> = {};
    config = await stepCompliance(config);      // step 1
    // ... 5 more interactive steps via @inquirer/prompts ...
  },
});
```
The `init` handler is fully interactive (`@inquirer/prompts`), so a real `init.handler({})` call would block on stdin. The plan's "smoke test" wording — `tino init --help` doesn't crash — points at the CLI argv path. Realistic options: (a) spawn the CLI binary via `execa` and assert exit code on `--help` (cmd-ts auto-generates help and exits 0 without invoking the handler); (b) skip a true smoke test and instead unit-test individual `step*` functions from `init/` by mocking `@inquirer/prompts`. Option (a) is closer to "smoke test" — write `await execa('bun', ['run', 'src/index.ts', 'init', '--help'])` and assert `exitCode === 0`.

**context — `packages/cli/src/commands/deploy.ts` (full file, 26 lines):**
```ts
export const deploy = command({
  name: 'deploy',
  description: 'Deploy tino to AWS (ECS Fargate)',
  args: {},
  handler: async () => {
    const configPath = resolve(process.cwd(), 'tino.deploy.json');
    if (!existsSync(configPath)) {
      displayError('tino.deploy.json not found. Run `tino init` first.');
      process.exit(1);
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as DeployConfig;
    await executeDeploy(config);
  },
});
```
Test pattern: spy `process.exit` (`vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)`), spy on the `displayError` import (`vi.mock('../utils/display.js', ...)` or import + spy), set `process.cwd()` to a temp dir without `tino.deploy.json`, call `deploy.handler({})`, assert both spies fired. The `executeDeploy` function lives in `src/commands/deploy-executor.ts` and calls AWS — DO NOT exercise it; the smoke test only covers the missing-config path.

**conventions:** vitest (`import { describe, it, expect, vi } from 'vitest'`); ESM `.js` extensions on relative imports; mock `@inquirer/prompts` and `execa` at module level via `vi.mock(...)` BEFORE importing the command; do NOT shell out to a globally-installed `tino` binary in tests — use `bun run src/index.ts` from the package root or call handlers directly; `process.exit` MUST be stubbed before any test that may trigger it (otherwise vitest itself exits); the new `vitest.config.ts` should mirror core's: `defineConfig({ test: { include: ['tests/**/*.{test,spec}.ts'] } })`. The root `package.json`'s `"test": "bun run --filter '*' test"` already fans out to every package — adding `"test": "vitest run"` to `packages/cli/package.json` automatically pulls CLI tests into the workspace-wide run.

**acceptance:**
- [x] `bun run test` from `packages/cli` runs and passes
- [x] root `bun run test` includes `@tino/cli` tests

## what does NOT change

- no behavioral changes to any source code
- existing tests unchanged
- no new runtime dependencies
