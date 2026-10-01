# contributing

## dev loop

Prerequisite: [Bun](https://bun.sh) 1.3. Nothing else — the database is PGlite
(Postgres + pgvector in WASM), stored in `./.data/pglite`.

```sh
bun install
bun run dev          # API on :3001, web on :5173 (proxies /api and /slack to the API)
```

Sign up on http://localhost:5173 — locally, emails aren't sent (links are logged)
and confirmation isn't required. Create an org and follow its setup checklist.

For Slack, expose :3001 with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3001`),
set `BASE_URL` to the tunnel URL, restart, then generate the manifest from
Settings → Slack. **Use a separate Slack app for dev** — it's per org anyway.

To run against real Postgres instead: `docker compose up -d postgres` and
`DATABASE_URL=postgres://tino:tino@localhost:5433/tino bun run dev`.

## checks

```sh
bun run typecheck
bun run test
bun run lint
```

Test the contract, not the implementation:

- **Stores** run against PGlite with the real schema (`apps/server/tests/_db.ts`). Every new store method needs a line in the org-isolation block of its suite.
- **Routes** mount on a bare Hono app with a fake `user`/`org` context (`tests/server/users-routes.test.ts`), or run end to end through `tests/server/_app.ts`, which wires real better-auth on PGlite.
- **Domain rules** (`packages/core`) are plain functions with plain tests.

## where things go

Read [`docs/architecture.md`](docs/architecture.md) first. The rules:

- `packages/core` (domain, application, ports) has **no dependencies**. If you need one, you're writing an adapter.
- Org data is only reached through `persistence.forOrg(orgId)`. Never add an `orgId` parameter to a store method — bind it at construction.
- Anything the customer configures is an org setting (add it to `SETTINGS` in `packages/contracts`). The platform environment (`apps/server/src/env.ts`) is for the operator only.
- Server ↔ web shapes go in `packages/contracts` first.

### adding a built-in tool

1. Write the tool under `apps/server/src/infrastructure/driven/tools/<area>/` using the AI SDK `tool({ description, inputSchema, execute })`. Throw on errors; the agent loop hands them back to the model.
2. Build it inside a per-user builder (`buildSlackUserTools`, `buildGoogleTools`, …) or add a builder to `createToolProvider`, wired in `bootstrap/org-runtime.ts`.
3. Bind any user id in the closure, never in the input schema.
4. Add a line to `packages/core/src/domain/prompt.ts` if the model needs guidance on when to use it.

### adding an OAuth provider

Add the capability and the approval it needs to `REQUIRED_APPROVAL` in
`packages/core/src/domain/oauth-clients.ts`, then resolve clients through
`OrgOAuthClients` — never read a client id/secret directly. Store the
`OAuthClientRef` with every token.

### or skip the code: MCP

If the system you want already has a remote MCP server, add it on the **Tools** page (workspace or personal).

## commits

Conventional-ish: `feat(kb): …`, `fix(slack): …`. Run typecheck, tests and lint before pushing.
