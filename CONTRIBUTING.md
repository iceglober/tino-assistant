# contributing

## dev loop

Prerequisites: [Bun](https://bun.sh), plus Docker if you need Postgres.

```sh
cp .env.example .env
bun install
bun run dev              # http://localhost:3001 — sqlite, knowledge base off
```

Sign up with email/password on localhost. The first account is the admin. Configure Slack and a model in Setup.

**Use a separate Slack app for dev.** Socket Mode spreads events across every connected process. With production tokens in `.env`, your laptop answers real users.

For Postgres parity (needed for anything touching the knowledge base):

```sh
docker compose up -d postgres    # pgvector on :5433
bun run dev:pg
```

## checks

```sh
bun run typecheck
bun run test                                                   # vitest
TEST_DATABASE_URL=postgres://tino:tino@localhost:5433/tino bun run test   # + Postgres contract suites
cd packages/core && bun run build                              # server (tsc) + console (vite)
```

Test the contract, not the implementation:

- Routes: mount them on a bare Hono app and call `app.request(...)`. See `tests/server/users-routes.test.ts`.
- Stores: run the same suite against sqlite and Postgres.

## where things go

Read [`docs/architecture.md`](docs/architecture.md) first. The rule: `domain/` and `application/` import only `ports/`, and every SDK stays in `infrastructure/`.

### adding a built-in tool

1. Write the tool under `infrastructure/driven/tools/<area>/` using the AI SDK `tool({ description, inputSchema, execute })`. Throw on errors; the agent loop hands them back to the model.
2. Build it inside a per-user builder (`buildSlackUserTools`, `buildGoogleTools`, …) or add a new builder to `createToolProvider` in `infrastructure/driven/tools/provider.ts`, wired in `bootstrap/main.ts`.
3. Bind any user id in the closure, never in the input schema.
4. Add a line to `domain/prompt.ts` if the model needs guidance on when to use it.

### or skip the code: MCP

If the system you want already has a remote MCP server, add it on the console **Tools** page (workspace or personal). No code change needed.

## console conventions

- Vite + React in `packages/core/src/console-app/`, built to `dist/console`.
- Design tokens only (`styles/tokens.css`); no inline hex.
- API calls go through `lib/api.ts`.

## commits

Conventional-ish: `feat(kb): …`, `fix(slack): …`. Run typecheck and tests before pushing.
