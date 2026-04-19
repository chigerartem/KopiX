# KopiX Production Runbook

Operational procedures for the single-instance production deployment (Docker
Compose). All paths are relative to the repo root unless noted.

Audience: whoever is on-call. Assumes SSH access to the prod host and
`$REPO/infra/compose/docker-compose.prod.yml` is the running stack.

---

## 1. Stack overview

| Service        | Role                                                  | Replicas |
| -------------- | ----------------------------------------------------- | -------- |
| `postgres`     | Primary DB (Postgres 16)                              | 1        |
| `pgbouncer`    | Connection pool (transaction mode, 200 max clients)   | 1        |
| `redis`        | Cache + Redis Streams signal bus (AOF on)             | 1        |
| `api`          | Fastify REST + SSE for the Mini App                   | 1+       |
| `bot`          | grammY Telegram bot (webhook mode)                    | 1        |
| `engine`       | Master watcher + signal consumer + executor           | **1 only** |
| `miniapp`      | Static React bundle served by nginx                   | 1+       |
| `caddy`        | TLS termination + reverse proxy                       | 1        |
| `prometheus`   | Metrics scrape, 30d retention                         | 1        |
| `alertmanager` | Telegram notifications for Prometheus alerts          | 1        |
| `grafana`      | Dashboards (auto-provisioned from `infra/monitoring`) | 1        |
| `backup`       | Cron job, daily 02:00 UTC `pg_dump` → S3              | 1        |

> **The engine must never run with `replicas: 2`.** Parallel consumers would
> place duplicate orders on the same signal. The Compose file pins it to 1.

---

## 2. Deploy an update

Images are built and pushed by GitHub Actions (`.github/workflows/deploy.yml`)
on every push to `main`. Each build pushes two tags: `${GITHUB_SHA}` and
`latest`. Deploy re-runs the compose stack with the new tag pinned.

```bash
# On the prod host:
cd /opt/kopix
export IMAGE_TAG=<git-sha>           # from the Actions run you want to deploy
export GITHUB_REPO=chigerartem/kopix # owner/repo in ghcr.io
docker compose -f infra/compose/docker-compose.prod.yml pull api bot engine miniapp
docker compose -f infra/compose/docker-compose.prod.yml up -d api bot engine miniapp
docker compose -f infra/compose/docker-compose.prod.yml ps
```

Post-deploy sanity:

```bash
curl -fs https://$APP_DOMAIN/health/live
curl -fs https://$APP_DOMAIN/health/ready
docker compose logs --tail=50 engine | grep -E 'consumer.started|master.ws.open'
```

Prisma migrations run automatically in `entrypoint-api.sh` before the API
starts serving traffic.

---

## 3. Rollback

If a deploy breaks production:

```bash
# Last known-good SHA should be pinned in the previous GitHub Actions run
export IMAGE_TAG=<previous-good-sha>
docker compose -f infra/compose/docker-compose.prod.yml pull api bot engine miniapp
docker compose -f infra/compose/docker-compose.prod.yml up -d api bot engine miniapp
```

If a Prisma migration is the offender: do **not** auto-downgrade. Contact the
DB owner; Prisma `migrate resolve` or a manual SQL fix is safer than a blind
downgrade. `pg_dump` backups from `backup` container are the last resort (see
§5).

---

## 4. Backup & restore

Daily `pg_dump` of `kopix` DB runs in the `backup` container at 02:00 UTC and
uploads `kopix-YYYYMMDD-HHMM.sql.gz` to `s3://${BACKUP_S3_BUCKET}/`. Retention
is 30 days (older objects are pruned by `backup.sh`).

Verify last backup:

```bash
aws s3 ls s3://$BACKUP_S3_BUCKET/ --recursive | sort | tail -5
```

### Restore from backup

```bash
# 1. Stop writers
docker compose stop engine bot api

# 2. Fetch the snapshot
aws s3 cp s3://$BACKUP_S3_BUCKET/kopix-YYYYMMDD-HHMM.sql.gz ./restore.sql.gz
gunzip restore.sql.gz

# 3. Drop & recreate the database (destructive — confirm you have the right SHA)
docker compose exec postgres psql -U $POSTGRES_USER -d postgres -c 'DROP DATABASE kopix;'
docker compose exec postgres psql -U $POSTGRES_USER -d postgres -c 'CREATE DATABASE kopix;'

# 4. Replay
cat restore.sql | docker compose exec -T postgres psql -U $POSTGRES_USER -d kopix

# 5. Restart writers
docker compose start api bot engine
```

After restore, verify the signal stream is consistent:

```bash
docker compose exec redis redis-cli XLEN trade-signals
docker compose exec redis redis-cli XPENDING trade-signals engine-group
```

---

## 5. Common incidents

### 5.1 `EngineDown` alert

The engine process is gone. Copy trading is halted.

1. `docker compose logs --tail=200 engine`
2. Look for an unrecoverable exception (BingX auth, Redis auth, Postgres auth).
3. `docker compose up -d engine` — Docker restart policy should already be
   trying, so repeated failure means the issue is config or code.
4. If the image itself is broken, rollback (§3).

### 5.2 `MasterWatcherDisconnected` / `MasterWatcherStale`

The engine is up but its WebSocket to BingX is not receiving events.

1. Check `masterWatcherConnected` in Grafana — is it 0 or flapping?
2. Check `masterWatcherLastEventTs` — if the gap exceeds the master's
   expected trade cadence, the WS has stalled silently.
3. `docker compose restart engine` will re-subscribe with a fresh listenKey.
4. If it persists: check BingX status page; rotate master API credentials if
   BingX returns `account disabled`.

### 5.3 `HighTradeFailureRate`

`kopix_trades_executed_total{status="failed"}` rising sharply.

1. `docker compose logs --tail=500 engine | grep trade.fail`.
2. Group the failures by reason:
   - **Auth errors** — subscriber credentials stale; the executor auto-
     suspends the subscriber. No action beyond watching the metric.
   - **Insufficient balance** — expected; check whether a specific whale user
     is spamming signals with a dry account.
   - **BingX 5xx** — exchange outage; signals stay in PEL and will replay
     when BingX recovers.
3. If the exchange is fully down, consider pausing the engine (`docker
   compose stop engine`) so PEL fills in an orderly way instead of burning
   retries. Restart once BingX recovers — XAUTOCLAIM drains the PEL.

### 5.4 `ApiHighErrorRate`

5xx rate > 1% for 5 min.

1. `docker compose logs --tail=500 api | grep -E '"level":50|error'`.
2. Most common causes historically:
   - DB connection saturation (pgbouncer pool exhausted) — scale `api` down
     or raise `PGBOUNCER_DEFAULT_POOL_SIZE`.
   - A bad deploy — rollback (§3).

### 5.5 Postgres down

1. `docker compose logs postgres` — disk full, OOM, corrupted WAL?
2. If the data volume is intact: `docker compose restart postgres` usually
   suffices. PgBouncer will reconnect automatically.
3. If the data volume is lost: restore from backup (§4).

---

## 6. Rotating secrets

All secrets are in `.env` on the prod host (base64-encoded in
`PROD_ENV_B64` GitHub secret for CI deploys).

- **`APP_ENCRYPTION_KEY`** — rotating this makes every stored subscriber API
  key unreadable. Do **not** rotate without a re-encryption migration.
  Procedure: dual-read (decrypt-with-old-or-new) for one deploy, rewrite all
  rows with new key, then drop old key support. Not supported yet — file an
  issue before attempting.
- **`TELEGRAM_BOT_TOKEN`** — rotate via BotFather; update `.env`; redeploy
  `api` and `bot`. The bot webhook needs to be re-registered.
- **`CRYPTOBOT_API_TOKEN`** / **`WEBHOOK_SECRET`** — update `.env`, redeploy
  `api`; existing signed URLs continue to work, only future webhooks use the
  new secret.
- **`MASTER_API_KEY` / `MASTER_API_SECRET`** — generate fresh BingX keys,
  update `.env`, `docker compose up -d engine`. Expect one disconnect.

---

## 7. Scaling up

- **API**: stateless. Increase replicas in Compose and Caddy load-balances
  automatically. Watch for pgbouncer pool saturation (`pg_stat_activity`).
- **Bot**: single instance (webhook target is a single URL). Do not scale.
- **Engine**: **never scale past 1**. If throughput becomes a bottleneck,
  shard signals by symbol inside a single engine process instead.
- **Miniapp**: stateless static content. Safe to scale; Caddy balances.

---

## 8. Observability quick reference

- Grafana: `https://$APP_DOMAIN/grafana` (admin / `$GRAFANA_ADMIN_PASSWORD`).
- Dashboard: "KopiX" — master watcher state, signal throughput, trade
  success/failure rates, API latency.
- Prometheus: `https://$APP_DOMAIN/prometheus` (internal only).
- Key metrics to eyeball during an incident:
  - `kopix_master_watcher_connected`
  - `kopix_master_watcher_last_event_ts` (age = `time() - value`)
  - `rate(kopix_signals_processed_total[5m])`
  - `rate(kopix_trades_executed_total{status="failed"}[5m])`
  - `histogram_quantile(0.95, sum by (le) (rate(kopix_api_http_request_duration_seconds_bucket[5m])))`

---

## 9. Load testing

```bash
# From a machine with k6 installed:
API_URL=https://$APP_DOMAIN TMA_INIT_DATA="..." k6 run infra/scripts/loadtest.js
```

The script holds 100 concurrent VUs for 2 minutes. Thresholds fail the run
if p95 > 500ms or error rate > 1%.

---

## 10. Contact

- **On-call rotation**: `#kopix-oncall` (Telegram).
- **Code owners**: see `CODEOWNERS` (PRs against `main` require a review).
- **Architecture source of truth**: `docs/ARCHITECTURE.md`.
