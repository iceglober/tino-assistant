# Tino on GCP — runbook

Project `quiet-spirit-503422-u3`, region `us-central1`. Cloud Run (always-on
single instance, Slack socket mode) + Cloud SQL Postgres 16 w/ pgvector +
Secret Manager + Vertex AI embeddings (service-account ADC, no keys).

## One-time provisioning

```bash
gcloud auth login
scripts/gcp-provision.sh
# then the manual steps it prints: OAuth client secrets + CREATE EXTENSION vector
```

Secrets: `tino-database-url`, `tino-google-oauth-client-id/secret`,
`tino-crypto-master-key` (AES master key — changing it invalidates all stored
credentials), `tino-connect-secret` (Slack connect-link signer).

## Deploy

```bash
BASE_URL=https://tino.kayn.ai scripts/gcp-deploy.sh     # or npm: bun run deploy:gcp
```

Cloud Build builds amd64 natively; the service runs `min=max=1 instance,
--no-cpu-throttling` because Slack socket mode must have exactly one owner and
the KB indexer runs in-process.

## Cutover from AWS (split-brain-safe order)

Slack socket-mode connections **split** events across connected instances —
never let AWS and GCP hold Slack tokens at the same time.

1. **Phase A — verify on run.app.** Deploy with `BASE_URL=<run.app URL>`.
   Don't enter Slack tokens (without them the app skips the socket connect).
   Add temporary Google OAuth redirect URIs for the run.app host:
   `/api/auth/callback/google` + `/api/oauth/google/callback`.
   Verify: `/api/health`, Google sign-in (first user = admin on the fresh DB),
   Setup saves, web chat replies, rows in Cloud SQL.
2. **Phase B — Slack ownership transfer** (no DNS needed): scale AWS to zero
   (`gsa exec --profile production -- aws ecs update-service --cluster
   api-cluster-prod --service tino --desired-count 0 --region us-east-1`),
   then enter the Slack bot+app tokens in the GCP console Setup and save.
   Slack is now served from GCP.
3. **Phase C — DNS.** Redeploy with `BASE_URL=https://tino.kayn.ai`. Create the
   Cloud Run domain mapping (requires kayn.ai verified in Search Console):
   `gcloud beta run domain-mappings create --service=tino
   --domain=tino.kayn.ai --region=us-central1`, flip the Route53 record for
   `tino.kayn.ai` to CNAME `ghs.googlehosted.com.`, wait for the managed cert
   (15–60 min; only the console is affected — Slack is outbound). Verify
   sign-in + connects on the domain, then remove the temp redirect URIs.

**Rollback:** flip Route53 back to the ALB alias, `--desired-count 1` on ECS,
blank the Slack tokens in GCP config (or scale Cloud Run to zero). AWS
DynamoDB/EFS state was never touched.

## Local dev

- Default: sqlite, zero deps (`bun run dev`). KB features off.
- Postgres parity: `docker compose up -d postgres` (pgvector, port **5433**)
  then `bun run dev:pg`. Contract tests:
  `TEST_DATABASE_URL=postgres://tino:tino@localhost:5433/tino bun run test`.
- Vertex embeddings locally: `gcloud auth application-default login`.
