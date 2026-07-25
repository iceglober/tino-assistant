#!/usr/bin/env bash
# Repeatable Tino deploy to Cloud Run.
#   BASE_URL=https://tino-<hash>-uc.a.run.app scripts/gcp-deploy.sh   # Phase A (run.app verify)
#   BASE_URL=https://tino.kayn.ai scripts/gcp-deploy.sh               # after DNS cutover
# Builds natively on Cloud Build (amd64) — no local Docker/QEMU needed.
set -euo pipefail

PROJECT="${GCP_PROJECT:-quiet-spirit-503422-u3}"
REGION="${GCP_REGION:-us-central1}"
SA_EMAIL="tino-run@$PROJECT.iam.gserviceaccount.com"
SQL_CONN="$PROJECT:$REGION:tino-pg"
BASE_URL="${BASE_URL:?set BASE_URL (run.app URL for Phase A, https://tino.kayn.ai after cutover)}"

SHA="$(git rev-parse --short HEAD)"
IMG="$REGION-docker.pkg.dev/$PROJECT/tino/tino:$SHA"

echo "=== Cloud Build: $IMG ==="
gcloud builds submit --project "$PROJECT" --tag "$IMG" .

echo "=== Cloud Run deploy (base URL: $BASE_URL) ==="
# min=max=1: single instance — Slack socket mode must have exactly one owner,
# and the KB indexer loop assumes a singleton. --no-cpu-throttling keeps CPU
# allocated between requests (WebSocket + background indexer).
gcloud run deploy tino \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMG" \
  --service-account "$SA_EMAIL" \
  --min-instances=1 --max-instances=1 \
  --no-cpu-throttling \
  --cpu=1 --memory=1Gi \
  --port=3001 \
  --add-cloudsql-instances="$SQL_CONN" \
  --set-env-vars="PERSISTENCE_ADAPTER=postgres,NODE_ENV=production,LOG_LEVEL=info,CONSOLE_BASE_URL=$BASE_URL,CONSOLE_ALLOWED_DOMAIN=kayn.ai,GOOGLE_VERTEX_PROJECT=$PROJECT,GOOGLE_VERTEX_LOCATION=$REGION" \
  --set-secrets="DATABASE_URL=tino-database-url:latest,GOOGLE_OAUTH_CLIENT_ID=tino-google-oauth-client-id:latest,GOOGLE_OAUTH_CLIENT_SECRET=tino-google-oauth-client-secret:latest,LOCAL_DEV_CRYPTO_KEY=tino-crypto-master-key:latest,CONNECT_SECRET=tino-connect-secret:latest" \
  --allow-unauthenticated

echo "=== done ==="
gcloud run services describe tino --project "$PROJECT" --region "$REGION" --format='value(status.url)'
