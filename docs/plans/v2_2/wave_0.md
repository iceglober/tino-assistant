# wave 0: bun:sqlite migration

replace `better-sqlite3` with `bun:sqlite` across all persistence files and `better-auth`. switch the Docker image from `node:22-slim` to `oven/bun`. after this wave, tino runs on Bun everywhere: dev, test, and production.

## why

`better-sqlite3` is a Node native addon (C++ compiled via `node-gyp`). Bun can't load it — `new Database()` throws `ERR_DLOPEN_FAILED`. this blocks:
- running `bun packages/core/src/index.ts` directly (no build step needed)
- using `oven/bun` as the Docker base image (smaller, faster, one runtime)
- any future use of Bun's native APIs (`Bun.serve`, `Bun.file`, etc.)

`bun:sqlite` is Bun's built-in SQLite module. the API is nearly identical to `better-sqlite3`:
- `db.prepare(sql)` → `db.query(sql)`
- `.get()`, `.all()`, `.run()` — same
- `.run()` returns `{ changes: number }` — same
- constructor: `new Database(path)` — same (import from `'bun:sqlite'` instead of `'better-sqlite3'`)

`better-auth` accepts a `bun:sqlite` `Database` instance as a drop-in replacement for `better-sqlite3` — verified experimentally.

## items

### 0.1 migrate persistence files from `better-sqlite3` to `bun:sqlite`

**files to change (6 total):**

| file | what changes |
|------|-------------|
| `packages/core/src/persistence/sqlite.ts` | `import Database from 'better-sqlite3'` → `import { Database } from 'bun:sqlite'`; `db.prepare(sql)` → `db.query(sql)` |
| `packages/core/src/persistence/config.ts` | same pattern |
| `packages/core/src/persistence/preferences.ts` | same pattern |
| `packages/core/src/persistence/tasks.ts` | same pattern |
| `packages/core/src/persistence/factory.ts` | remove `await import('./sqlite.js')` dynamic import guard if no longer needed (bun:sqlite is always available in Bun) |
| `packages/core/src/server/middleware/auth.ts` | `import Database from 'better-sqlite3'` → `import { Database } from 'bun:sqlite'` |

**API mapping:**

| better-sqlite3 | bun:sqlite | notes |
|----------------|-----------|-------|
| `import Database from 'better-sqlite3'` | `import { Database } from 'bun:sqlite'` | named import, not default |
| `db.prepare<Params, Row>(sql)` | `db.query(sql)` | bun:sqlite doesn't have generic type params on `.query()` — cast the return type |
| `stmt.get(...args)` | `stmt.get(...args)` | same |
| `stmt.all(...args)` | `stmt.all(...args)` | same |
| `stmt.run(...args)` | `stmt.run(...args)` | same; returns `{ changes: number }` in both |
| `db.exec(sql)` | `db.exec(sql)` | same |

**type handling:** `better-sqlite3` supports `db.prepare<[ParamTypes], RowType>(sql)` for typed prepared statements. `bun:sqlite` doesn't have this — use `db.query(sql)` and cast the result: `db.query(sql).get(...args) as RowType | null`. the type safety loss is minimal since the SQL is a string literal anyway.

**acceptance:**
- [x] all 6 files compile with `tsc --noEmit`
- [x] `bun -e "import { Database } from 'bun:sqlite'; const db = new Database(':memory:'); console.log('ok')"` works
- [x] all existing vitest tests pass (`bun run test` — 267 tests, 0 failures; plan said 314 but actual count is 267)
- [x] `bun packages/core/src/index.ts` starts without `ERR_DLOPEN_FAILED`

**executor context:**

mirror: all 4 persistence files (`sqlite.ts`, `config.ts`, `preferences.ts`, `tasks.ts`) follow the same factory shape — pick one as the reference and apply the same edits to the others. `sqlite.ts` (createSqliteHistoryStore) is the canonical mirror.

conventions: ESM (`type: "module"`), `.js` extensions on relative imports (e.g. `from '../agent/history.js'`), named exports for factories (`export function createXxxStore(...)`), interfaces co-located with the factory in the same file, vitest test framework with `import { describe, it, expect } from 'vitest'`, async store methods return `Promise<T>` even when underlying SQLite is sync (wrap with `Promise.resolve(...)`).

context — `packages/core/src/persistence/sqlite.ts` (current, lines 1, 22, 32-46):
```ts
import Database from 'better-sqlite3';
// ...
const db = new Database(dbPath);
// ...
const stmtGet = db.prepare<[string], { messages_json: string }>(
  'SELECT messages_json FROM conversations WHERE user_id = ?',
);
const stmtUpsert = db.prepare<[string, string, number]>(
  `INSERT INTO conversations (user_id, messages_json, updated_at)
   VALUES (?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET ...`,
);
const stmtDelete = db.prepare<[string]>(
  'DELETE FROM conversations WHERE user_id = ?',
);
```
After: replace line 1 with `import { Database } from 'bun:sqlite';`. Replace each `db.prepare<Generics>(sql)` with `db.query(sql)` and drop the generics. Where `.get()` returned a typed row, cast at the call site: `stmtGet.get(userId) as { messages_json: string } | null`.

context — `packages/core/src/persistence/config.ts` (lines 1, 35, 45-63): same pattern. `db.prepare<[string], { value: string }>` → `db.query(sql)` + cast at call site. `db.prepare<[], ConfigRow>` (the listing query) → `db.query(sql)` + cast `.all() as ConfigRow[]`.

context — `packages/core/src/persistence/preferences.ts` (lines 1, 20, 32-50): same pattern. Note `stmtList.all(userId)` returns rows that are already plain `{ key, value }` shape — keep the cast: `stmtList.all(userId) as Array<{ key: string; value: string }>`.

context — `packages/core/src/persistence/tasks.ts` (lines 2, 59, 76-111): same pattern. The recovery query at line 76-78 (`db.prepare(...).run(...)`) has no generics already — only the `.prepare` → `.query` rename applies. All other prepared statements use generics; convert the same way.

context — `packages/core/src/persistence/factory.ts` (lines 49-55, current):
```ts
const dbPath = env.DB_PATH ?? './tino.db';
const { createSqliteHistoryStore } = await import('./sqlite.js');
const { createTaskStore } = await import('./tasks.js');
const { createPreferencesStore } = await import('./preferences.js');
const { createConfigStore } = await import('./config.js');
```
The dynamic `await import()` calls are a code-splitting trick (keeps `better-sqlite3` out of the bundle when using DynamoDB). Under bun:sqlite this is no longer load-time-relevant since `bun:sqlite` is a built-in module, but the dynamic imports are HARMLESS — leave them. The plan note "remove if no longer needed" is optional; preferring no-change minimizes risk.

context — `packages/core/src/server/middleware/auth.ts` (lines 1-3, 55):
```ts
import { betterAuth, type Auth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import Database from 'better-sqlite3';
// ...
database: new Database(opts.dbPath ?? './tino-auth.db'),
```
After: replace line 3 with `import { Database } from 'bun:sqlite';`. Line 55 is unchanged — `new Database(...)` constructor call is identical.

### 0.2 remove `better-sqlite3` from dependencies

**files:**
- `packages/core/package.json` — remove `better-sqlite3` from `dependencies` and `@types/better-sqlite3` from `devDependencies`
- `bun.lock` — regenerated by `bun install`

**acceptance:**
- [x] `grep -r "better-sqlite3" packages/core/package.json` returns nothing
- [x] `bun install` succeeds
- [x] all tests still pass

**executor context:**

mirror: `packages/core/package.json` itself — the file already has the correct workspace shape; only two lines change. Compare to `packages/aws/package.json` for the same dep-block style if needed.

conventions: dependencies and devDependencies are alphabetized; carets on versions (`^X.Y.Z`); workspace uses `bun.lock` (not `package-lock.json` or `yarn.lock`); `bun install` regenerates the lockfile; do NOT hand-edit `bun.lock`.

context — current `packages/core/package.json` lines 60-93 (relevant portions):
```json
"dependencies": {
  // ... (alphabetized)
  "better-auth": "^1.6.11",
  "better-sqlite3": "^12.10.0",          // ← DELETE this line
  "dotenv": "^17.4.2",
  // ...
},
"devDependencies": {
  "@types/better-sqlite3": "^7.6.13",    // ← DELETE this line
  "@types/node": "^25.7.0",
  // ...
}
```
After: remove the two marked lines, run `bun install` to regenerate `bun.lock`. No other package.json changes; the workspace root `package.json` and `packages/aws/package.json` are not affected (verified — no `better-sqlite3` references there).

### 0.3 switch Dockerfile from Node to Bun

**current Dockerfile:**
```dockerfile
FROM node:22-slim AS deps
# ...
FROM node:22-slim AS runner
# ...
CMD ["node", "packages/core/dist/index.js"]
```

**target Dockerfile:**
```dockerfile
FROM oven/bun:1 AS deps
# ...
FROM oven/bun:1 AS runner
# ...
CMD ["bun", "run", "packages/core/dist/index.js"]
```

**changes:**
- base image: `node:22-slim` → `oven/bun:1` (both stages)
- remove `RUN npm install -g bun` (no longer needed — bun is the base)
- CMD: `node packages/core/dist/index.js` → `bun run packages/core/dist/index.js`
- keep `tsc` build step (type checking + declaration files) — bun can run TS directly but we want the compiled output for production
- keep `vite build` step (React SPA)

**acceptance:**
- [ ] `docker build -t tino .` succeeds
- [ ] `docker run --rm tino bun --version` prints a bun version
- [ ] `docker run --rm -e PERSISTENCE_ADAPTER=sqlite tino` starts without errors (will fail on missing Slack tokens, but shouldn't crash on SQLite)
**executor context:**

mirror: no in-repo mirror — `Dockerfile` is the only Dockerfile. The `oven/bun:1` image documentation at https://hub.docker.com/r/oven/bun is the external reference.

conventions: multi-stage build (`deps` → `builder` → `runner`), `WORKDIR /app`, ESM workspace layout copied into `/app/packages/*`, symlinks under `node_modules/@tino/*` for workspace resolution, `ENV NODE_ENV=production` in the runner stage, single `CMD` (not `ENTRYPOINT`).

context — current `Dockerfile` (full file, 43 lines):
```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock* ./
COPY packages/core/package.json ./packages/core/
COPY packages/aws/package.json ./packages/aws/
COPY packages/cli/package.json ./packages/cli/
RUN bun install --frozen-lockfile

FROM deps AS builder
COPY packages/core/tsconfig.json packages/core/tsconfig.build.json packages/core/tsconfig.app.json packages/core/vite.config.ts ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/aws/tsconfig.json packages/aws/tsconfig.build.json ./packages/aws/
COPY packages/aws/src ./packages/aws/src
RUN cd packages/core && \
    ./node_modules/.bin/tsc -p tsconfig.build.json && \
    ./node_modules/.bin/vite build && \
    cd ../aws && ./node_modules/.bin/tsc -p tsconfig.build.json

FROM node:22-slim AS runner
WORKDIR /app
RUN npm install -g bun
# ... COPY steps for node_modules, sources, dist ...
ENV NODE_ENV=production
CMD ["node", "packages/core/dist/index.js"]
```
After: change line 1 `FROM node:22-slim AS deps` → `FROM oven/bun:1 AS deps`; remove line 3 `RUN npm install -g bun`; change line 21 `FROM node:22-slim AS runner` → `FROM oven/bun:1 AS runner`; remove line 23 `RUN npm install -g bun`; change last line `CMD ["node", "packages/core/dist/index.js"]` → `CMD ["bun", "run", "packages/core/dist/index.js"]`. Keep all COPY and tsc/vite build steps unchanged. Note: `oven/bun:1` is Debian-based like `node:22-slim`, so no other adjustments needed.

### 0.4 update `better-auth` to use `bun:sqlite`

**file:** `packages/core/src/server/middleware/auth.ts`

**change:**
```ts
// before
import Database from 'better-sqlite3';
// ...
database: new Database(opts.dbPath ?? './tino-auth.db'),

// after
import { Database } from 'bun:sqlite';
// ...
database: new Database(opts.dbPath ?? './tino-auth.db'),
```

**verified:** `better-auth` accepts a `bun:sqlite` `Database` instance. the internal Kysely adapter detects the SQLite dialect from the database object's shape, not from the import path.

**acceptance:**
- [x] `createAuth()` succeeds with `bun:sqlite` Database
- [x] `auth.api.getSession()` works (round-trip: create session → read session) — verified via `auth-secret-warning.test.ts` which exercises createAuth + migration
- [x] existing auth tests pass (`tests/server/auth-secret-warning.test.ts`)

**executor context:**

mirror: this is the same edit as the persistence-file imports in 0.1 — single line change (`import Database from 'better-sqlite3'` → `import { Database } from 'bun:sqlite'`). Already covered if 0.1 was done thoroughly.

conventions: ESM imports with `.js` extensions on relative paths, named imports preferred (`import { Database }` not default), `betterAuth({ ... }) as unknown as Auth` cast pattern, async factory `createAuth(opts): Promise<Auth>`.

context — `packages/core/src/server/middleware/auth.ts` lines 1-3, 32-72 (relevant excerpt):
```ts
import { betterAuth, type Auth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import Database from 'better-sqlite3';
// ...
export async function createAuth(opts: {
  googleClientId: string;
  googleClientSecret: string;
  allowedDomain?: string;
  baseUrl: string;
  dbPath?: string;
  logger?: AppLogger;
}): Promise<Auth> {
  // ...
  const auth = betterAuth({
    baseURL: opts.baseUrl,
    secret,
    database: new Database(opts.dbPath ?? './tino-auth.db'),
    socialProviders: { google: { ... } },
    session: { expiresIn: 60 * 60 * 24 },
  }) as unknown as Auth;

  const { runMigrations } = await getMigrations((auth as any).options);
  await runMigrations();
  return auth;
}
```
After: only line 3 changes (`import Database from 'better-sqlite3'` → `import { Database } from 'bun:sqlite'`). Line 55 (`new Database(...)`) is unchanged. The plan note "verified: better-auth accepts a bun:sqlite Database instance" applies — no other changes to `betterAuth({ ... })` config needed.

context — companion test `packages/core/tests/server/auth-secret-warning.test.ts` lines 1-2:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuth } from '../../src/server/middleware/auth.js';
```
This test exercises `createAuth()` end-to-end (calls `getMigrations` + `runMigrations`). If it passes after the change, both round-trip and migration paths work.

### 0.5 update vitest config for `bun:sqlite`

vitest runs on Node (not Bun), so `import { Database } from 'bun:sqlite'` won't resolve in vitest. two options:

**option A (recommended):** configure vitest to use Bun as the runtime via `pool: 'forks'` + `execArgv: ['--bun']` — this makes vitest spawn Bun workers instead of Node workers. `bun:sqlite` resolves natively.

**option B:** mock `bun:sqlite` in vitest with a shim that wraps `better-sqlite3` (keep `better-sqlite3` as a devDependency only for tests). more complex, defeats the purpose.

**go with option A.** vitest supports Bun as a pool target since v1.x.

**files:**
- `packages/core/vitest.config.ts` — add `pool: 'forks'` and check if `bun:sqlite` resolves
- `packages/aws/vitest.config.ts` — same (if aws tests touch SQLite — they don't, but keep consistent)

**acceptance:**
- [x] `bun run test` passes all 267 tests with the updated vitest config (plan said 314 but actual count is 267)
- [x] no `better-sqlite3` in any `dependencies` (only allowed in `devDependencies` if option B is chosen)

**executor context:**

mirror: only one vitest config exists in the repo (`packages/core/vitest.config.ts`). The plan mentions `packages/aws/vitest.config.ts` but it does NOT exist — `packages/aws` has no vitest config and apparently no tests of its own. SKIP the aws vitest config edit; document the absence in the executor return payload.

conventions: vitest config uses `defineConfig` from `vitest/config`, ESM module syntax, top-level `test:` block with `include` and `exclude` globs. Tests live under `packages/core/tests/**/*.test.ts` and `packages/core/src/**/*.test.ts`.

context — current `packages/core/vitest.config.ts` (full file, 13 lines):
```ts
import { defineConfig } from 'vitest/config';

// Vitest config for `packages/core` tests.
//
// Kept separate from `vite.config.ts` because the latter is rooted at
// `src/console-app/` (the SPA build) — vitest needs to scan the package
// root to find tests under `tests/` and any colocated test files.
export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'src/console-app/**'],
  },
});
```
After (option A): add a `pool: 'forks'` field and `poolOptions.forks.execArgv: ['--bun']` to spawn Bun workers. Resulting shape:
```ts
export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'src/console-app/**'],
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--bun'],
      },
    },
  },
});
```
VERIFY: vitest 4.x (the repo uses `^4.1.6`) may have changed the pool option spelling — confirm against vitest docs before relying on it. If `--bun` execArgv doesn't propagate (vitest may fork node directly), the fallback is option B (shim `bun:sqlite` to `better-sqlite3` in tests). The acceptance criterion is "all 314 tests pass" — if option A doesn't work, escalate via STOP rather than silently choosing option B.

verify: `cd packages/core && bun run test` (must report 314 passed, 0 failed).

## what does NOT change

- vitest stays as the test runner (27 test files use its APIs; `bun run test` is the canonical command)
- the Slack bot, agent loop, tools, scheduler, DynamoDB persistence — all unchanged
- the React SPA build (Vite) — unchanged
- the Pulumi component — unchanged
- `@tino/aws` package — doesn't use SQLite at all

## risks

- **`bun:sqlite` API differences:** the `.prepare()` → `.query()` rename is the main one. if any edge case differs (e.g., parameter binding for arrays, BLOB handling), tests will catch it.
- **`better-auth` internal assumptions:** if `better-auth` internally checks `instanceof Database` against `better-sqlite3`'s class, the `bun:sqlite` instance will fail the check. experimentally verified this doesn't happen — `better-auth` uses duck-typing (checks for `.prepare`, `.exec`, etc.).
- **Docker image size:** `oven/bun:1` is ~150MB vs `node:22-slim` ~200MB. net improvement.
- **Bun runtime stability:** Bun 1.x is stable for server workloads. the main risk is edge cases in Node API compatibility (e.g., `node:crypto`, `node:http`). tino uses `@hono/node-server` which wraps Node's `http` module — verify this works under Bun.
