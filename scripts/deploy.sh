#!/usr/bin/env bash
# KopiX production deploy — run on the VPS.
#
#   cd /opt/kopix
#   ./scripts/deploy.sh
#
# Idempotent: safe to re-run. Does not touch Postgres/Redis (those live in
# infra/compose/docker-compose.data.yml and are started once at setup).

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

if [[ ! -f "$REPO_ROOT/.env" ]]; then
    echo "error: $REPO_ROOT/.env is missing. Create it from .env.example first." >&2
    exit 1
fi

DEPLOY_BRANCH="${DEPLOY_BRANCH:-dev}"
echo "[deploy] pulling latest ${DEPLOY_BRANCH}..."
git fetch --prune origin
git checkout "$DEPLOY_BRANCH"
git pull --ff-only origin "$DEPLOY_BRANCH"

COMMIT_SHA="$(git rev-parse --short HEAD)"
export COMMIT_SHA
echo "[deploy] deploying commit $COMMIT_SHA"

echo "[deploy] installing dependencies..."
npm ci

echo "[deploy] building workspaces..."
npm run build

echo "[deploy] running database migrations..."
npm run db:migrate

echo "[deploy] seeding database (idempotent)..."
npm run db:seed

# Persist COMMIT_SHA so pm2 reload --update-env picks it up. pm2 reads env from
# the shell that invokes it, so exporting above is enough for this run; we also
# append it to .env so an out-of-band `pm2 restart` still has it.
if grep -q "^COMMIT_SHA=" .env; then
    sed -i.bak "s|^COMMIT_SHA=.*|COMMIT_SHA=${COMMIT_SHA}|" .env && rm -f .env.bak
else
    printf "\nCOMMIT_SHA=%s\n" "$COMMIT_SHA" >> .env
fi

echo "[deploy] reloading pm2 processes..."
if pm2 describe kopix-api >/dev/null 2>&1; then
    pm2 reload ecosystem.config.cjs --update-env
else
    pm2 start ecosystem.config.cjs
    pm2 save
fi

echo "[deploy] re-registering Telegram webhook (idempotent)..."
node --env-file=.env --import tsx scripts/register-webhook.ts

echo "[deploy] done. Commit $COMMIT_SHA is live."
pm2 ls
