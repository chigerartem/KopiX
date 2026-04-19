#!/bin/sh
# Pack infra/compose/.env into a base64 string suitable for the PROD_ENV_B64
# GitHub Secret.
#
# Usage (run from repo root):
#   sh infra/scripts/mk-secret.sh
#
# Copy the printed line into:
#   GitHub → repo Settings → Secrets and variables → Actions
#   Name: PROD_ENV_B64

set -e

ENV_FILE="infra/compose/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found. Copy .env.example and fill it in first." >&2
  exit 1
fi

echo ""
echo "=== PROD_ENV_B64 (paste this into the GitHub Secret) ==="
echo ""
base64 -w 0 "$ENV_FILE"
echo ""
echo ""
echo "=== Done ==="
