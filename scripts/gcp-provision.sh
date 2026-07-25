#!/usr/bin/env bash
# One-time GCP provisioning for Tino (project quiet-spirit-503422-u3).
# Idempotent-ish: safe to re-run; existing resources error harmlessly ("already exists").
#
# Prereqs: gcloud auth login; billing enabled on the project.
# After running: put real values into the secrets (see the echo at the end),
# then deploy with scripts/gcp-deploy.sh.
set -euo pipefail

PROJECT="${GCP_PROJECT:-quiet-spirit-503422-u3}"
REGION="${GCP_REGION:-us-central1}"
SA_NAME="tino-run"
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
SQL_INSTANCE="tino-pg"

gcloud config set project "$PROJECT"

echo "=== 1/5 Enable APIs ==="
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com

echo "=== 2/5 Artifact Registry ==="
gcloud artifacts repositories create tino \
  --repository-format=docker --location="$REGION" \
  --description="tino images" || true

echo "=== 3/5 Cloud SQL Postgres 16 (db-g1-small) ==="
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_16 \
  --region="$REGION" \
  --tier=db-g1-small \
  --storage-size=10GB \
  --storage-auto-increase \
  --availability-type=zonal || true
gcloud sql databases create tino --instance="$SQL_INSTANCE" || true

DB_PASSWORD="$(openssl rand -hex 24)"
gcloud sql users create tino --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" || {
  echo "user exists — resetting password"
  gcloud sql users set-password tino --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
}

echo "=== 4/5 Secrets ==="
for s in tino-database-url tino-google-oauth-client-id tino-google-oauth-client-secret \
         tino-crypto-master-key tino-connect-secret; do
  gcloud secrets create "$s" --replication-policy=automatic || true
done

# Seed the ones we can generate; OAuth client id/secret must be added manually.
printf '%s' "postgresql://tino:$DB_PASSWORD@/tino?host=/cloudsql/$PROJECT:$REGION:$SQL_INSTANCE" \
  | gcloud secrets versions add tino-database-url --data-file=-
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add tino-crypto-master-key --data-file=-
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add tino-connect-secret --data-file=-

echo "=== 5/5 Service account + IAM ==="
gcloud iam service-accounts create "$SA_NAME" --display-name="tino cloud run" || true
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/cloudsql.client --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/aiplatform.user --condition=None >/dev/null
for s in tino-database-url tino-google-oauth-client-id tino-google-oauth-client-secret \
         tino-crypto-master-key tino-connect-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$SA_EMAIL" --role=roles/secretmanager.secretAccessor >/dev/null
done

cat <<EOF

Provisioning done. REMAINING MANUAL STEPS:
1. Google OAuth client (console.cloud.google.com → Credentials):
     printf '%s' '<client-id>'     | gcloud secrets versions add tino-google-oauth-client-id --data-file=-
     printf '%s' '<client-secret>' | gcloud secrets versions add tino-google-oauth-client-secret --data-file=-
2. Enable pgvector (once):
     gcloud sql connect $SQL_INSTANCE --user=tino --database=tino
     tino=> CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname='vector';
   (needs >= 0.7 for halfvec — Cloud SQL PG16 ships >= 0.8)
3. Deploy: BASE_URL=https://<hash>.run.app scripts/gcp-deploy.sh   (Phase A)
EOF
