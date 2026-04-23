#!/bin/sh
# Daily PostgreSQL backup → gzip → S3
# Runs inside the backup container via cron.
set -e

DATE=$(date +%Y-%m-%d_%H-%M-%S)
FILE="/tmp/kopix_${DATE}.sql.gz"

echo "[backup] Dumping database at ${DATE}..."
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST}" \
  -U "${POSTGRES_USER}" \
  -d kopix \
  --no-owner \
  --no-acl \
  | gzip > "${FILE}"

echo "[backup] Uploading to s3://${BACKUP_S3_BUCKET}/postgres/${DATE}.sql.gz ..."
AWS_DEFAULT_REGION="${BACKUP_S3_REGION}" \
aws s3 cp "${FILE}" "s3://${BACKUP_S3_BUCKET}/postgres/${DATE}.sql.gz"

rm -f "${FILE}"
echo "[backup] Done."

# Retain last 30 days only
aws s3 ls "s3://${BACKUP_S3_BUCKET}/postgres/" \
  | awk '{print $4}' \
  | sort \
  | head -n -30 \
  | xargs -I{} aws s3 rm "s3://${BACKUP_S3_BUCKET}/postgres/{}" 2>/dev/null || true
