# contributing

How to develop tino locally, run the test suite, and add a new tool or capability.

## prerequisites

- Node 22 (`nvm use` in the repo root reads `.nvmrc`).
- pnpm (`npm install -g pnpm`).
- Docker, if you want to test the container build path.
- AWS credentials, only if you want to test against real Bedrock or DynamoDB; local dev runs on SQLite without them.

## the dev loop

```sh
git clone <repo> tino && cd tino
nvm use
cp .env.example .env
# fill in .env — at minimum, the Slack tokens for your dev workspace and the
# Bedrock model ID. You can also leave Slack tokens blank and configure them
# via the local console.
pnpm install
pnpm dev
```

`pnpm dev` runs `tsx watch` on `@tino/core`. The console is at `http://localhost:3001`. Edits to `packages/core/src/**` reload automatically. SPA changes go through Vite — the React dev server is mounted by Hono in dev mode.

## tests

```sh
pnpm test                 # everything, vitest
pnpm --filter @tino/core test
pnpm --filter @tino/aws test
pnpm typecheck            # tsc --noEmit across all packages
```

Coverage is uneven — load-bearing modules (persistence, audit, agent loop, config store) are well-covered; the Pulumi component is typecheck-only because we don't have a Pulumi mock.

The test runner is `vitest`. Bun's `bun test` does NOT work for `@tino/core` — `better-sqlite3` is incompatible with Bun's runtime. Always use `pnpm test` (which invokes vitest) or `npx vitest run` directly.

### test patterns

- Persistence stores: spin up a temp SQLite file and exercise the contract. See [`packages/core/tests/persistence/config.test.ts`](packages/core/tests/persistence/config.test.ts).
- DynamoDB stores: mock the toolbox client per [`packages/core/tests/tools/preferences.test.ts`](packages/core/tests/tools/preferences.test.ts).
- Hono routes: use Hono's test client (`app.request(...)`) — see [`packages/core/tests/server/admin-routes.test.ts`](packages/core/tests/server/admin-routes.test.ts).
- React components: vitest + happy-dom — see [`packages/core/tests/console-app/`](packages/core/tests/console-app).

Always test the contract, not the implementation. If you're inspecting private state to assert behaviour, the test is wrong.

## adding a new tool

A tool is a function the LLM can call. The shortest path:

1. **Pick or create a capability.** Tools live inside capabilities — a capability is the credential boundary. If your tool needs a credential nobody else has, create a new capability schema in `packages/core/src/capabilities/`. If it can reuse an existing one (e.g. another GitHub query), add the tool inside that capability.

2. **Define the tool.** In `packages/core/src/tools/<capability>/<tool>.ts`:

   ```ts
   import { tool } from 'ai';
   import { z } from 'zod';

   export function makeGetWidget(deps: { token: string; logger: AppLogger }) {
     return tool({
       description: 'Get a widget by ID.',
       inputSchema: z.object({
         widgetId: z.string().describe('The widget ID to fetch.'),
       }),
       async execute({ widgetId }) {
         // …
       },
     });
   }
   ```

   Conventions:
   - One file per tool. Filenames match the camelCase tool name.
   - Inputs are zod-validated. Every field has a `.describe()` so the LLM gets help text.
   - The tool factory takes a `deps` bag — credentials, the logger, anything else it needs. The capability registry instantiates it at registry build time.
   - Throw on errors. The agent loop catches them, records `status: 'error'` in the audit log, and gives the LLM a chance to recover.

3. **Wire it into the capability.** In `packages/core/src/capabilities/<capability>.ts` add the tool to the capability's `instantiate` function. The registry calls `instantiate(config)` with the validated capability config and expects a tools map back.

4. **Register the credential schema.** If your tool needs new credentials, add them to the capability's zod schema. The schema drives:
   - The console UI (capability card fields are derived from the schema).
   - The validator (saves to the config store fail validation if missing).
   - The registry (capabilities with invalid config are not instantiated).

5. **Write the test.** At minimum: a zod-schema test for the input parsing and an `execute` test with a mocked dependency. Don't test the actual external API in unit tests — mock the SDK call. End-to-end tests against a real GitHub/Linear/etc. account belong in a separate manual checklist.

6. **Audit-log the call.** Tools don't log directly; the agent loop wraps `execute` and writes the audit entry. As long as your tool's `execute` is the function passed to `tool({ ... })`, the audit trail is automatic. **Never** add `inputKeys` containing parameter values — only key names.

## adding a new capability

Same as adding a tool, but you also:

1. Create `packages/core/src/capabilities/<capability>.ts` with:
   - A zod schema for the capability's config.
   - An `instantiate(config)` function that returns the tools map.
   - An entry in `packages/core/src/capabilities/all.ts` that ties the schema, instantiate function, display metadata (icon, name, description) together.

2. The console picks it up automatically — capability cards are generated from the registry. Test by saving credentials in the local console and confirming the capability shows "connected" in the card.

3. The registry hot-reloads on `POST /api/reload/capabilities`, so adding the capability while tino is running is fine — no restart needed.

## working with the SPA

The console SPA lives in `packages/core/src/console-app/`. It's Vite + React, built into `dist/console-app/` and served by Hono. To work on it:

```sh
pnpm --filter @tino/core dev
```

Vite's HMR is on for the SPA in dev mode. The API routes are at the same origin, so `fetch('/api/...')` works.

Conventions:
- TypeScript strict mode; no `any`. If a third-party type is broken, narrow with a single guarded cast and a comment.
- Design tokens only. Never inline hex; reach for `var(--accent)`, `var(--err)`, etc. Tokens live in `packages/core/src/console-app/styles/tokens.css`.
- One component per file. Hooks colocated with their consumer if used in one place; lifted to `hooks/` if reused.

## working with Pulumi

The `TinoService` component is in `packages/aws/src/pulumi/tino-service.ts`. To test changes:

1. Generate a sandbox infra dir: `mkdir /tmp/tino-test && cd /tmp/tino-test && pulumi new typescript`.
2. Edit `index.ts` to import `TinoService` from the local `@tino/aws` build.
3. `pulumi up` against a throwaway stack.

There are no Pulumi unit tests in this repo because the component's value is in the resource graph it produces, not in pure logic. Typechecking + `pulumi preview` against a sandbox stack is the contract.

## commit + PR conventions

- Commit messages: `<scope>: <wave-N — short summary>` matches the existing log. See `git log --oneline`.
- Run `pnpm typecheck` and `pnpm test` before opening a PR.
- Don't bypass git hooks. If a hook fails, fix the cause.

## architecture notes

For how the pieces fit, see [`docs/architecture.md`](docs/architecture.md). For what the component enforces, see [`docs/security.md`](docs/security.md).
