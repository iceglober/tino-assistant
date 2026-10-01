<p align="center">
  <img src="assets/tino-logo.png" alt="tino" width="120">
</p>

# tino

Your team's assistant in Slack, as a managed service. Teams sign up, connect
Slack, Gmail and Google Calendar, and tino answers from *their* context — with
per-person OAuth, so it reads each person's messages **with their own token**,
never a bot token that can see everyone's.

- **Slack + web chat** — DM the bot, @mention it in a channel, or chat on the web.
- **Accounts and orgs** — sign up, create or join an org, invite your team, or let your email domain join.
- **Bring your own OAuth clients** — each org connects its *own* Slack app (one click from a generated manifest) and its *own* Google client, so neither Google's restricted-scope audit nor Slack's non-Marketplace rate limits apply. Tino's own clients switch on per capability as they're approved. See [`docs/managed-service.md`](docs/managed-service.md).
- **Bring your own model** — OpenAI, Anthropic or Azure OpenAI, with the org's own key.
- **Knowledge bases** — a shared workspace KB and a private per-person KB, distilled into facts and themes, searched with recency-weighted ranking.
- **Who may see what** — every reply uses only what all of its readers may see; private context never reaches a channel.
- **MCP tools** — workspace servers (admins) and personal ones.

## Deploy (Railway)

Infrastructure is TypeScript in [`.railway/railway.ts`](.railway/railway.ts): one
service from the `Dockerfile` and Railway Postgres 18 (pgvector included).

```sh
railway link
bash scripts/railway-bootstrap.sh                 # generates ENCRYPTION_KEY + AUTH_SECRET, once
TINO_DOMAIN=tino.example railway config plan
TINO_DOMAIN=tino.example railway config apply
```

Then set `ORG_CREATORS` (production starts as a closed beta) and `RESEND_API_KEY`
in the dashboard. Everything a customer configures lives in their org, not in
the environment — see [`.env.example`](.env.example) for the operator's settings.

## Local development

```sh
bun install
bun run dev          # API on :3001 (PGlite, no database to install) + web on :5173
```

Open http://localhost:5173, sign up (no email confirmation locally), create an
org, and follow the setup checklist. To try Slack locally, expose :3001 with a
tunnel and set `BASE_URL` to it before generating the Slack manifest.

| Command | What it does |
|---|---|
| `bun run dev` | API + web, both watching |
| `bun run test` | every package's tests (Postgres suites run on PGlite — nothing to set up) |
| `bun run typecheck` | TypeScript, every package |
| `bun run lint` | Biome |
| `bun run build` | build the web app into `apps/web/dist/client` |

## Layout

```
apps/server         the process: HTTP API, Slack events, per-org runtimes, KB scheduler
apps/web            React Router 8 SPA (Vite)
packages/core       domain, use-cases and ports — no dependencies
packages/contracts  the HTTP contract shared by server and web
.railway/           infrastructure as code
```

## Documentation

- [`docs/managed-service.md`](docs/managed-service.md) — the managed service: BYO vs managed OAuth, thresholds, tenancy, Railway
- [`docs/user-journeys.md`](docs/user-journeys.md) — sign-up, org setup, members, everyday use, MCP
- [`docs/architecture.md`](docs/architecture.md) — how tino is put together
- [`docs/security.md`](docs/security.md) — access control, isolation, secrets, known gaps
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev loop, tests, where things go
