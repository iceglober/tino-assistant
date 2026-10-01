<p align="center">
  <img src="assets/tino-logo.png" alt="tino" width="120">
</p>

# tino

A personal AI assistant that lives in your Slack DMs and a small web console. It
answers from *your* context: your Slack, your email, your calendar — using
per-user OAuth, so it reads your private messages **with your own token**, never
a bot token that can see everyone's.

- **Slack + web chat** — DM the bot, @mention it in a channel, or use the console chat box.
- **Per-user access** — each person connects their own Slack and Google; tools are built per user, per message.
- **Knowledge bases** — a shared workspace KB (public channels) and a private per-user KB (your DMs, private channels, email), incrementally indexed and searched with semantic + **recency-weighted** ranking.
- **It draws conclusions** — a distillation pass turns indexed history into durable facts (projects, open problems, commitments, decisions, people) each carrying the messages that back it, plus labelled themes. Browse both in the console; tino answers from them.
- **MCP tools** — connect remote MCP servers from the console: workspace-wide with a shared token (admins) or personal with your own.
- **User management** — invite people or let your whole domain join, promote admins, suspend access.
- **Bring your own model** — Azure OpenAI, OpenAI, or Anthropic, chosen in the console.

## Deploy

Tino ships as a **Helm chart** — one always-on container plus a Postgres
database (pgvector for the knowledge base).

```sh
helm install tino deploy/helm/tino \
  --set consoleBaseUrl=https://tino.example.com \
  --set secretEnv.DATABASE_URL=postgres://user:pw@host:5432/tino \
  --set secretEnv.LOCAL_DEV_CRYPTO_KEY=$(openssl rand -hex 32) \
  --set secretEnv.CONNECT_SECRET=$(openssl rand -hex 32)
```

Then open the console, sign in (the first user becomes admin — set
`--set allowedEmailDomain=example.com` before exposing the URL), and
fill in Setup: Slack tokens, a model provider + key, and the Google OAuth client
if it isn't already in the environment.

**Requirements**
- Kubernetes + any Postgres with **pgvector ≥ 0.7** (or `--set postgresql.enabled=true` for a dev-grade bundled one).
- A Slack app in **Socket Mode** (no public webhook needed).
- Knowledge-base embeddings use Vertex AI — set `GOOGLE_VERTEX_PROJECT`/`LOCATION` with ADC or a mounted key. Without it the KB stays off and everything else works.

> **The chart runs a single replica on purpose** (`replicas: 1`, `strategy: Recreate`).
> Slack Socket Mode load-balances events across connections, so two pods split
> conversations randomly; the KB indexer also assumes a singleton. Don't scale it.

The reference deployment (GKE Autopilot + Cloud SQL + Workload Identity) is
documented in [`docs/gcp.md`](docs/gcp.md), with provisioning and deploy scripts
in [`scripts/`](scripts).

## Documentation

- [`docs/user-journeys.md`](docs/user-journeys.md) — first install, new users, everyday use, admin, MCP
- [`docs/gcp.md`](docs/gcp.md) — the reference GKE deployment, end to end
- [`docs/console.md`](docs/console.md) — using the web console
- [`docs/architecture.md`](docs/architecture.md) — how tino is put together
- [`docs/security.md`](docs/security.md) — access control, secrets, known gaps
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — local dev, tests, adding tools

## Local development

```sh
cp .env.example .env
bun install
bun run dev            # sqlite, zero dependencies (knowledge base off)
```

For Postgres parity (required for KB work):

```sh
docker compose up -d postgres      # pgvector on :5433
bun run dev:pg
```

| Command | What it does |
|---|---|
| `bun run dev` / `dev:pg` | Start with sqlite / Postgres, watching for changes |
| `bun run test` | vitest (`TEST_DATABASE_URL=…` also runs the Postgres contract suites) |
| `bun run typecheck` | TypeScript check (no emit) |
| `bun run deploy:gcp` | Cloud Build → Artifact Registry → `helm upgrade` |

## Architecture in one paragraph

A strict hexagon: `domain/` and `application/` depend only on `ports/`, and all
I/O lives in `infrastructure/driving` (Slack, HTTP) and `infrastructure/driven`
(model, tools, persistence, crypto, knowledge base). Even the LLM sits behind a
`ChatModel` port — the AI SDK's agent loop exists in exactly one adapter.
`bootstrap/main.ts` is the composition root. See
[`docs/architecture.md`](docs/architecture.md).
