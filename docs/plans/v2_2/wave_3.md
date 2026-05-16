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

**acceptance:**
- [ ] 6 new test files, each with ≥ 2 test cases
- [ ] `bun run test` passes with the new tests
- [ ] route coverage: every route handler has at least one happy-path and one error-path test

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

**acceptance:**
- [ ] 6 new test files
- [ ] each capability's `registerTools()` is tested with valid and invalid config
- [ ] `bun run test` passes

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

**acceptance:**
- [ ] 4 new test files
- [ ] `bun run test` passes

### 3.4 CLI smoke tests

**new files:**
- `packages/cli/package.json` — add `"test": "vitest run"`
- `packages/cli/vitest.config.ts` — NEW (minimal config)
- `packages/cli/tests/commands/init.test.ts` — smoke test: `tino init --help` doesn't crash
- `packages/cli/tests/commands/deploy.test.ts` — smoke test: `executeDeploy` with missing infra dir calls `displayError` + `process.exit(1)` (already tested in core — move or duplicate)

**acceptance:**
- [ ] `bun run test` from `packages/cli` runs and passes
- [ ] root `bun run test` includes `@tino/cli` tests

## what does NOT change

- no behavioral changes to any source code
- existing tests unchanged
- no new runtime dependencies
