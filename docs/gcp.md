# Tino on GCP (KayN) — GKE Autopilot + Helm runbook

KayN dogfoods the self-hosting Helm chart (`deploy/helm/tino`). Stack: GKE
Autopilot (project `quiet-spirit-503422-u3`, region `us-central1`) + Cloud SQL
Postgres 16 w/ pgvector (via cloud-sql-proxy sidecar) + Secret Manager +
Workload Identity (Vertex embeddings + Cloud SQL, zero keys). KayN-specific
values: `deploy/kayn/values-kayn.yaml` (destined for the kn-eng repo).

The chart enforces a **single replica with strategy Recreate** — Slack Socket
Mode splits events across connections and the KB indexer is a singleton. Never
scale it.

## One-time provisioning

```bash
gcloud auth login
scripts/gcp-provision.sh
# then the manual steps it prints:
#  - add the Google OAuth client id/secret to Secret Manager
#  - CREATE EXTENSION vector on the tino DB (>=0.7 needed for halfvec)
```

Creates: APIs, Artifact Registry `tino`, Cloud SQL `tino-pg` + db/user,
secrets (`tino-database-url` in TCP-via-proxy form, generated crypto/connect
keys), GSA `tino-run` (cloudsql.client + aiplatform.user) with Workload
Identity binding to `tino/tino`, Autopilot cluster `tino`, global static IP
`tino-ip`.

## Deploy

```bash
scripts/gcp-deploy.sh   # or: bun run deploy:gcp
```

Cloud Build builds amd64 natively → Artifact Registry; the script refreshes
the `tino-env` k8s Secret from Secret Manager and `helm upgrade --install`s
with the kayn values (image tag = git sha).

## Cutover from AWS

Slack socket-mode connections **split** events across connected instances —
AWS and GCP must never both hold Slack tokens. With GKE the DNS flip comes
*before* the Slack transfer (the AWS bot keeps running through it; only the
console moves):

1. **Deploy + smoke** — run the deploy; verify via
   `kubectl -n tino port-forward svc/tino 3001:80` → `/api/health`, SPA loads.
   Sign-in can't work yet (domain still points at AWS). The GKE
   ManagedCertificate stays `Provisioning` until DNS resolves — expected.
2. **DNS flip (console-only outage window)** — Route53: `tino.kayn.ai` A
   record → the `tino-ip` static IP. AWS console becomes unreachable; the AWS
   *bot* keeps answering (socket mode is outbound, console-independent). Wait
   for the managed cert (15–60 min after DNS), then sign in at
   https://tino.kayn.ai (first user = admin on the fresh DB) and fill Setup:
   model provider + Google OAuth — **not the Slack tokens yet**.
3. **Slack ownership transfer** — scale AWS to zero:
   `gsa exec --profile production -- aws ecs update-service --cluster
   api-cluster-prod --service tino --desired-count 0 --region us-east-1`,
   then enter the Slack bot+app tokens in the GCP console Setup and save.
   Verify a DM, `connect`, and a tool call. Done.

**Rollback:** Route53 back to the ALB alias, `--desired-count 1` on ECS, blank
the Slack tokens in the GCP config. AWS DynamoDB/EFS state was never touched.

Also: temporarily add `https://tino.kayn.ai/api/auth/callback/google` +
`/api/oauth/google/callback` to the NEW Google OAuth client if not already
present (they should be — same domain as before).

## Self-hosting (the chart itself)

```bash
helm install tino deploy/helm/tino \
  --set consoleBaseUrl=https://tino.example.com \
  --set secretEnv.DATABASE_URL=postgres://... \
  --set secretEnv.LOCAL_DEV_CRYPTO_KEY=$(openssl rand -hex 32) \
  --set secretEnv.CONNECT_SECRET=$(openssl rand -hex 32)
```

Needs any Postgres with pgvector ≥0.7 (or `--set postgresql.enabled=true` for
a dev-grade bundled one). KB embeddings need Vertex credentials (ADC /
Workload Identity on GKE, or a mounted service-account key elsewhere); without
them the KB stays off and everything else works.

## Local dev

- Default: sqlite, zero deps (`bun run dev`). KB features off.
- Postgres parity: `docker compose up -d postgres` (pgvector, port **5433**)
  then `bun run dev:pg`. Contract tests:
  `TEST_DATABASE_URL=postgres://tino:tino@localhost:5433/tino bun run test`.
- Vertex embeddings locally: `gcloud auth application-default login`.
