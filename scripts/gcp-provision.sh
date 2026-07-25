#!/usr/bin/env bash
# One-time GCP provisioning for KayN's Tino (GKE Autopilot + Cloud SQL + Vertex).
# Idempotent-ish: re-running errors harmlessly on existing resources.
# NOTE: destined to move to the kn-eng repo; lives here temporarily.
#
# Prereqs: gcloud auth login; billing enabled.
set -euo pipefail

PROJECT="${GCP_PROJECT:-quiet-spirit-503422-u3}"
REGION="${GCP_REGION:-us-central1}"
SA_NAME="tino-run"
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
SQL_INSTANCE="tino-pg"
CLUSTER="tino"
NAMESPACE="tino"
KSA="tino"   # chart serviceAccountName for release name "tino"

# Neutralize any ambient project override from the parent shell (e.g.
# CLOUDSDK_CORE_PROJECT) — it silently redirects every gcloud call.
export CLOUDSDK_CORE_PROJECT="$PROJECT"
gcloud config set project "$PROJECT"

echo "=== 1/7 Enable APIs ==="
gcloud services enable \
  container.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  compute.googleapis.com
# Fresh projects: enablement returns before it propagates to the API frontends.
sleep 45

echo "=== 2/7 Artifact Registry ==="
gcloud artifacts repositories create tino \
  --repository-format=docker --location="$REGION" \
  --description="tino images" || true

echo "=== 3/7 Cloud SQL Postgres 16 (db-g1-small) ==="
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_16 \
  --region="$REGION" \
  --edition=enterprise \
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

echo "=== 4/7 Secrets ==="
for s in tino-database-url tino-google-oauth-client-id tino-google-oauth-client-secret \
         tino-crypto-master-key tino-connect-secret; do
  gcloud secrets create "$s" --replication-policy=automatic || true
done
# TCP form — the pod reaches Cloud SQL through the cloud-sql-proxy sidecar.
printf '%s' "postgresql://tino:$DB_PASSWORD@127.0.0.1:5432/tino" \
  | gcloud secrets versions add tino-database-url --data-file=-
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add tino-crypto-master-key --data-file=-
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add tino-connect-secret --data-file=-

echo "=== 5/7 Service account + IAM (Workload Identity) ==="
gcloud iam service-accounts create "$SA_NAME" --display-name="tino runtime" || true
# SA creation propagates asynchronously — poll before binding.
for i in $(seq 1 12); do
  gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 && break
  sleep 5
done
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/cloudsql.client --condition=None >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/aiplatform.user --condition=None >/dev/null

echo "=== 6/7 GKE Autopilot cluster ==="
gcloud container clusters create-auto "$CLUSTER" --region="$REGION" || true

# Workload Identity binding must come AFTER the first cluster exists — the
# PROJECT.svc.id.goog identity pool is created with it.
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:$PROJECT.svc.id.goog[$NAMESPACE/$KSA]" >/dev/null

echo "=== 7/8 Global static IP for the ingress ==="
gcloud compute addresses create tino-ip --global || true
gcloud compute addresses describe tino-ip --global --format='value(address)'

cat <<EOF

Provisioning done. REMAINING MANUAL STEPS:
1. Google OAuth client secrets:
     printf '%s' '<client-id>'     | gcloud secrets versions add tino-google-oauth-client-id --data-file=-
     printf '%s' '<client-secret>' | gcloud secrets versions add tino-google-oauth-client-secret --data-file=-
2. Enable pgvector (once):
     gcloud sql connect $SQL_INSTANCE --user=tino --database=tino
     tino=> CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname='vector';
   (needs >= 0.7 for halfvec — Cloud SQL PG16 ships >= 0.8)
3. Deploy: scripts/gcp-deploy.sh
4. DNS: point tino.kayn.ai (Route53) at the static IP printed above (A record).
EOF

# NOTE: run AFTER the first `helm install` creates the Ingress.
# GKE's L7 health-check firewall rule (k8s-fw-l7--*) is generated with the
# kube-system default backend's port only; the container's serving port must be
# added or every LB health check fails and the ingress serves 502s.
ensure_health_check_port() {
  local port="${1:-3001}"
  local rule
  rule="$(gcloud compute firewall-rules list --filter='name~^k8s-fw-l7--' --format='value(name)' | head -1)"
  [ -z "$rule" ] && { echo "no k8s-fw-l7 rule yet — re-run after the first helm install"; return 0; }
  local ports
  ports="$(gcloud compute firewall-rules describe "$rule" --format='value(allowed[].map().firewall_rule().list())')"
  case "$ports" in
    *"tcp:$port"*) echo "health-check firewall already allows tcp:$port" ;;
    *) gcloud compute firewall-rules update "$rule" --allow="$ports,tcp:$port" && echo "added tcp:$port to $rule" ;;
  esac
}
