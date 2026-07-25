#!/usr/bin/env bash
# Repeatable KayN deploy: Cloud Build (native amd64) → Artifact Registry →
# refresh the tino-env k8s Secret from Secret Manager → helm upgrade --install.
# NOTE: destined to move to the kn-eng repo; lives here temporarily.
set -euo pipefail

PROJECT="${GCP_PROJECT:-quiet-spirit-503422-u3}"
export CLOUDSDK_CORE_PROJECT="$PROJECT"
REGION="${GCP_REGION:-us-central1}"
CLUSTER="tino"
NAMESPACE="tino"

SHA="$(git rev-parse --short HEAD)"
IMG_REPO="$REGION-docker.pkg.dev/$PROJECT/tino/tino"

echo "=== Cloud Build: $IMG_REPO:$SHA ==="
gcloud builds submit --project "$PROJECT" --tag "$IMG_REPO:$SHA" .

echo "=== Cluster credentials ==="
gcloud container clusters get-credentials "$CLUSTER" --region "$REGION" --project "$PROJECT"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "=== Refresh tino-env secret from Secret Manager ==="
sm() { gcloud secrets versions access latest --secret="$1" --project "$PROJECT"; }
kubectl -n "$NAMESPACE" create secret generic tino-env \
  --from-literal=DATABASE_URL="$(sm tino-database-url)" \
  --from-literal=LOCAL_DEV_CRYPTO_KEY="$(sm tino-crypto-master-key)" \
  --from-literal=CONNECT_SECRET="$(sm tino-connect-secret)" \
  --from-literal=GOOGLE_OAUTH_CLIENT_ID="$(sm tino-google-oauth-client-id)" \
  --from-literal=GOOGLE_OAUTH_CLIENT_SECRET="$(sm tino-google-oauth-client-secret)" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "=== helm upgrade --install ==="
helm upgrade --install tino deploy/helm/tino \
  --namespace "$NAMESPACE" \
  -f deploy/kayn/values-kayn.yaml \
  --set image.repository="$IMG_REPO" \
  --set image.tag="$SHA" \
  --wait --timeout 10m

echo "=== status ==="
kubectl -n "$NAMESPACE" get pods,ingress
echo "Ingress IP (Route53 A record for tino.kayn.ai):"
gcloud compute addresses describe tino-ip --global --format='value(address)' 2>/dev/null || true

# GKE generates the L7 health-check firewall rule (k8s-fw-l7--*) with only the
# kube-system default backend's port. Our container serves on 3001, so without
# this the LB health checks can never reach the pod: backend UNHEALTHY → 502 on
# every request after a pod replacement. Idempotent.
PORT_TO_ALLOW=3001
RULE="$(gcloud compute firewall-rules list --filter='name~^k8s-fw-l7--' --format='value(name)' | head -1)"
if [ -n "$RULE" ]; then
  PORTS="$(gcloud compute firewall-rules describe "$RULE" --format='value(allowed[].map().firewall_rule().list())')"
  case "$PORTS" in
    *"tcp:$PORT_TO_ALLOW"*) echo "health-check firewall ok (tcp:$PORT_TO_ALLOW allowed)" ;;
    *) gcloud compute firewall-rules update "$RULE" --allow="$PORTS,tcp:$PORT_TO_ALLOW" >/dev/null &&
       echo "added tcp:$PORT_TO_ALLOW to $RULE" ;;
  esac
fi
