#!/usr/bin/env bash
# One-time setup for a Railway environment: generate the two platform secrets
# if they aren't set yet. Safe to re-run — existing values are never replaced.
#
#   railway link && bash scripts/railway-bootstrap.sh [service]
set -euo pipefail
SERVICE="${1:-tino}"

current() { railway variables --service "$SERVICE" --kv 2>/dev/null | grep -E "^$1=" || true; }

for name in ENCRYPTION_KEY AUTH_SECRET; do
  if [ -n "$(current "$name")" ]; then
    echo "$name already set — leaving it alone"
  else
    railway variables --service "$SERVICE" --set "$name=$(openssl rand -hex 32)" --skip-deploys >/dev/null
    echo "$name generated"
  fi
done

echo
echo "Back up ENCRYPTION_KEY somewhere safe: losing it makes every stored credential unreadable."
echo "Next: railway config plan && railway config apply"
