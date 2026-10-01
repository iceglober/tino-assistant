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
# NEVER deploy an unbuilt tag: the chart uses strategy Recreate, so helm kills
# the running pod first and a missing image leaves prod down in
# ImagePullBackOff. `set -e` covers the direct path; this is the explicit guard
# for anyone copying these steps into a chained/CI invocation.
if ! gcloud builds submit --project "$PROJECT" --tag "$IMG_REPO:$SHA" .; then
  echo "BUILD FAILED — not deploying (prod keeps running the previous image)" >&2
  exit 1
fi
# Belt and braces: confirm the tag actually exists in the registry.
gcloud artifacts docker images describe "$IMG_REPO:$SHA" --project "$PROJECT" >/dev/null

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
# --force-conflicts: recovering an outage with `kubectl set image` leaves that
# field owned by the kubectl-set field manager, and server-side apply then
# refuses every later deploy. The chart is the source of truth, so reclaim it.
helm upgrade --install tino deploy/helm/tino \
  --namespace "$NAMESPACE" \
  -f deploy/kayn/values-kayn.yaml \
  --set image.repository="$IMG_REPO" \
  --set image.tag="$SHA" \
  --take-ownership --force-conflicts \
  --wait --timeout 10m

echo "=== status ==="
kubectl -n "$NAMESPACE" get pods,ingress
echo "Ingress IP (Route53 A record for tino.kayn.ai):"
gcloud compute addresses describe tino-ip --global --format='value(address)' 2>/dev/null || true

# GKE generates the L7 health-check firewall rule (k8s-fw-l7--*) with only the
# kube-system default backend's port. Our container serves on 3001, so without
# this the LB health checks can never reach the pod: backend UNHEALTHY → 502 on
# every request after a pod replacement. Idempotent.
PORT_TO_ALLOW=8080
RULE="$(gcloud compute firewall-rules list --filter='name~^k8s-fw-l7--' --format='value(name)' | head -1)"
if [ -n "$RULE" ]; then
  PORTS="$(gcloud compute firewall-rules describe "$RULE" --format='value(allowed[].map().firewall_rule().list())')"
  case "$PORTS" in
    *"tcp:$PORT_TO_ALLOW"*) echo "health-check firewall ok (tcp:$PORT_TO_ALLOW allowed)" ;;
    *) gcloud compute firewall-rules update "$RULE" --allow="$PORTS,tcp:$PORT_TO_ALLOW" >/dev/null &&
       echo "added tcp:$PORT_TO_ALLOW to $RULE" ;;
  esac
fi
