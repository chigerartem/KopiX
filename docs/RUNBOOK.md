# KopiX — Operations Runbook

Day-to-day operations for the native (pm2) deployment. Assumes you've
completed the [first-time setup in DEPLOY.md](DEPLOY.md).

All commands run as the `kopix` user on the VPS unless stated otherwise.

---

## Quick reference

```bash
cd /opt/kopix

./scripts/deploy.sh              # deploy latest main
pm2 status                       # what's running
pm2 logs kopix-engine --lines 200
pm2 restart kopix-api            # single-service restart
pm2 reload ecosystem.config.cjs  # reload all with new env
```

---

## Deploy a new version

```bash
cd /opt/kopix
./scripts/deploy.sh
```

Runs: `git pull` → `npm ci` → `npm run build` → `npm run db:migrate` →
`pm2 reload` → `webhook:register`. Idempotent — running it twice in a row on a
clean tree is a fast no-op.

---

## Rollback

```bash
cd /opt/kopix
git log --oneline -n 10
git checkout <previous-sha>
./scripts/deploy.sh
```

If the previous commit had an older Prisma schema you need to restore the
nightly dump first — **prisma migrate deploy does not roll back**.

```bash
gunzip -c /var/backups/kopix/<yyyy-mm-dd>.sql.gz \
  | docker exec -i kopix-postgres psql -U kopix kopix
```

---

## Restart a single service

```bash
pm2 restart kopix-api        # or kopix-bot, kopix-engine
```

For the engine, prefer `restart` over `reload` — Node's `--require` hooks +
Redis consumer group handshake are finicky during graceful reload.

---

## Logs

```bash
pm2 logs                              # all streams
pm2 logs kopix-engine --lines 500     # single process
pm2 logs --err                        # stderr only

# Raw files (rotated by pm2)
ls ~/.pm2/logs/
```

Caddy logs: `journalctl -u caddy -f`.
Postgres / Redis: `docker compose -f infra/compose/docker-compose.data.yml logs -f`.

---

## Data layer

```bash
docker compose -f infra/compose/docker-compose.data.yml ps
docker compose -f infra/compose/docker-compose.data.yml restart redis
docker compose -f infra/compose/docker-compose.data.yml restart postgres
```

### DB shell

```bash
docker exec -it kopix-postgres psql -U kopix kopix
```

### Redis CLI

```bash
docker exec -it kopix-redis redis-cli
```

---

## DB backup / restore

### Nightly cron (host)

```cron
# /etc/cron.d/kopix-backup (as root)
0 3 * * * kopix docker exec kopix-postgres pg_dump -U kopix kopix \
  | gzip > /var/backups/kopix/$(date +\%F).sql.gz
```

### Manual backup

```bash
docker exec kopix-postgres pg_dump -U kopix kopix \
  | gzip > /var/backups/kopix/$(date +%F).sql.gz
```

### Restore

```bash
gunzip -c /var/backups/kopix/2026-04-18.sql.gz \
  | docker exec -i kopix-postgres psql -U kopix kopix
```

---

## Telegram webhook

### Re-register (idempotent)

```bash
cd /opt/kopix
npm run webhook:register
```

Deploys already call this — you only re-run it manually if:

- You rotated `BOT_WEBHOOK_SECRET`
- You changed `APP_DOMAIN`
- Telegram reports the webhook as missing (`getWebhookInfo` returns empty url)

### Check current webhook

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | jq
```

---

## Miniapp cache / "user sees old UI"

Root cause: Telegram WebView caches `index.html` aggressively by URL.

Fix (already implemented):

1. Caddy serves `/index.html` with `Cache-Control: no-store`. Verify:
   ```bash
   curl -I https://${APP_DOMAIN}/ | grep -i cache-control
   # cache-control: no-store
   ```
2. Bot-posted URL contains `?v=<COMMIT_SHA>`. Verify in logs:
   ```bash
   pm2 logs kopix-bot | grep miniapp
   ```
3. `/assets/*` is `immutable, max-age=31536000` (content-hashed filenames).

If a user still reports stale UI:

- Telegram Desktop: right-click tray icon → Quit (not just close window).
- Telegram iOS: force-quit + reopen.
- Confirm the bot URL they tapped contains the current `?v=<sha>`.

---

## Engine singleton — how to verify

```bash
pm2 describe kopix-engine | grep -E 'exec mode|instances'
# exec mode       │ fork_mode
# instances       │ 1
```

**Never** do `pm2 scale kopix-engine 2`. A second instance subscribes to the
same Redis stream with the same consumer name and will duplicate fills.

Runtime self-check: the engine acquires a Redis consumer-group lock on startup;
a second process aborts with `engine-lock-held`.

---

## Caddy

```bash
sudo systemctl reload caddy         # after editing /etc/caddy/Caddyfile
sudo systemctl status caddy
sudo caddy validate --config /etc/caddy/Caddyfile
journalctl -u caddy -n 200
```

---

## System reboot recovery

systemd brings everything back automatically:

```
systemd → docker.service      → compose services (restart=unless-stopped)
       → caddy.service         → reads /etc/caddy/Caddyfile
       → pm2-kopix.service     → resurrects api, bot, engine from pm2 dump
```

Sanity check after reboot:

```bash
pm2 status
docker compose -f /opt/kopix/infra/compose/docker-compose.data.yml ps
curl -sI https://${APP_DOMAIN}/api/healthz
```

---

## Incident triage

### API returning 5xx

1. `pm2 logs kopix-api --lines 200`
2. `curl -s http://127.0.0.1:3000/api/healthz` — direct, bypass Caddy
3. `docker exec kopix-postgres pg_isready -U kopix`
4. `pm2 restart kopix-api` if process is wedged

### Bot not responding

1. `curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | jq`
2. `pm2 logs kopix-bot`
3. Re-run `npm run webhook:register`
4. Check Caddy route: `curl -sI https://${APP_DOMAIN}/api/bot/webhook` → 405 (POST only) is healthy

### Engine stalled (no trades copied)

1. `pm2 logs kopix-engine --lines 500`
2. Check master WS watcher: look for `bingx:ws:connected` log
3. Check Redis stream backlog:
   ```bash
   docker exec kopix-redis redis-cli XLEN trade-signals
   docker exec kopix-redis redis-cli XINFO GROUPS trade-signals
   ```
4. `pm2 restart kopix-engine`

### Subscriber can't connect API key

1. Confirm key has **trade permission only**, no withdraw (`/connect` rejects
   withdraw-enabled keys by design).
2. `pm2 logs kopix-api | grep credentials`
3. Check `APP_ENCRYPTION_KEY` is set and 32 bytes (64 hex chars).

---

## Secrets

- `.env` lives at `/opt/kopix/.env`, mode `600`, owned by `kopix`.
- Never commit. Never paste into chat or logs.
- `APP_ENCRYPTION_KEY` rotation is not yet implemented — rotating it would
  orphan every subscriber's stored credentials. Tracked as a follow-up.

---

## Known limitations

- **Single-VPS SPOF.** No HA. Matches prior Docker setup.
- **No Prometheus/Grafana** by default. Metrics endpoints still exist; attach
  an external scraper if you need alerting.
- **pgbouncer removed** — Prisma's built-in pool is enough at current scale.
  Reintroduce if `pg_stat_activity` shows pool exhaustion.
