#!/usr/bin/env bash
# Usage: ./scripts/setup-secrets.sh secrets.json
# Reads a JSON file and creates/updates SSM parameters for each key.
# Each key becomes /tino/<KEY> as a SecureString parameter.
set -euo pipefail

SECRETS_FILE="${1:?Usage: $0 <secrets.json>}"
REGION="${AWS_REGION:-us-east-1}"

if [ ! -f "$SECRETS_FILE" ]; then
  echo "ERROR: $SECRETS_FILE not found"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed. Install with: brew install jq"
  exit 1
fi

echo "Setting SSM parameters from $SECRETS_FILE (region: $REGION)..."
count=0
while IFS= read -r key; do
  value=$(jq -r ".[\"$key\"]" "$SECRETS_FILE")
  param_name="/tino/$key"
  echo "  $param_name"
  aws ssm put-parameter \
    --name "$param_name" \
    --value "$value" \
    --type SecureString \
    --overwrite \
    --region "$REGION" \
    --no-cli-pager > /dev/null
  count=$((count + 1))
done < <(jq -r 'keys[]' "$SECRETS_FILE")
echo "Done. $count parameters set."
