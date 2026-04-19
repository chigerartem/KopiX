#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
./node_modules/.bin/prisma migrate deploy --schema=packages/db/prisma/schema.prisma

echo "[entrypoint] Starting API server..."
exec node apps/api/dist/index.js
