# deployment

Tino is distributed as a Helm chart (`deploy/helm/tino`) — one always-on
container plus a Postgres database with pgvector.

- **Self-hosting quickstart** — see the Deploy section of [`../README.md`](../README.md).
- **Reference deployment** (GKE Autopilot + Cloud SQL + Secret Manager +
  Workload Identity, serving `tino.kayn.ai`) — see [`gcp.md`](gcp.md), including
  provisioning, the deploy pipeline, and cutover/rollback notes.

> The previous AWS path (Pulumi `TinoService`, ECS/Fargate, ALB, DynamoDB, the
> `tino init` CLI) was retired on 2026-07-25 when Tino moved to GCP.
> `packages/aws` and `packages/cli` were removed; their history is in git if you
> ever need to resurrect the component.

## What a deployment needs

| Requirement | Notes |
|---|---|
| Kubernetes | Any cluster; the chart pins a single replica (Socket Mode + singleton indexer). |
| Postgres + pgvector ≥ 0.7 | Everything lives here: config, users, identities, encrypted credentials, chat history, better-auth tables, and the knowledge base (`halfvec(3072)` + HNSW). |
| Slack app in Socket Mode | Bot + app tokens. Add the OAuth client id/secret to enable the per-user `connect` flow. |
| A model provider | Azure OpenAI, OpenAI, or Anthropic — chosen in the console Setup page. |
| Vertex AI credentials *(optional)* | Only for knowledge-base embeddings. Without them the KB stays off and everything else works. |

## Secrets the container expects

Supplied via `existingSecret` or `secretEnv` (the chart renders a Secret):

- `DATABASE_URL` — Postgres connection string
- `LOCAL_DEV_CRYPTO_KEY` — master key encrypting per-user credentials at rest. **Changing it invalidates every stored credential.**
- `CONNECT_SECRET` — signs the personal Slack connect links the bot DMs out
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — console sign-in + Gmail/Calendar

Redirect URIs to register on the Google OAuth client:
`https://<host>/api/auth/callback/google` and `https://<host>/api/oauth/google/callback`.
For Slack add `https://<host>/api/oauth/slack/callback` plus the user token
scopes listed in [`gcp.md`](gcp.md).

## Ports and health

The container serves on **8080** (`PORT`, driven by `service.targetPort`) and
exposes `GET /api/health` for liveness/readiness. On GKE, keep the serving port
in the L7 health-check firewall rule — see the gotcha in [`gcp.md`](gcp.md).
