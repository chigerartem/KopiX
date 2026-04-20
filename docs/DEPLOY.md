# KopiX — Production Deployment Guide

KopiX runs natively on a single Ubuntu VPS with **pm2** managing Node processes
and **Caddy** terminating TLS. Postgres and Redis run in a tiny Docker Compose
(that's the only Docker the daily workflow touches). Deploys are one command:

```bash
cd /opt/kopix && ./scripts/deploy.sh
```

No CI/CD builds of Docker images. No SSH from GitHub Actions. No base64 env
blobs. The runtime is reproducible from `git pull` + `npm run build`.

---

## Architecture

```
systemd ──┬── pm2-kopix.service   → api, bot, engine processes
          ├── caddy.service       → /etc/caddy/Caddyfile (host install)
          └── docker              → pg + redis (compose, restart=unless-stopped)

Caddy (443/80) ─┬─ /api/bot/webhook → 127.0.0.1:3001   (grammY)
                ├─ /api/*           → 127.0.0.1:3000   (Fastify)
                ├─ /assets/*        → file_server (immutable, 1y)
                └─ default          → file_server apps/miniapp/dist (no-store)
```

Processes:

| Name         | Script                          | Port | Notes                           |
|--------------|---------------------------------|------|---------------------------------|
| kopix-api    | `apps/api/dist/index.js`        | 3000 | Fastify + Zod                   |
| kopix-bot    | `apps/bot/dist/index.js`        | 3001 | grammY webhook                  |
| kopix-engine | `apps/engine/dist/index.js`     | 9090 | **singleton** — never scale > 1 |
| miniapp      | static, built by vite, served by Caddy | — | `apps/miniapp/dist/` |

The engine is pinned to `instances: 1, exec_mode: "fork"` in
`ecosystem.config.cjs`. Running two engine processes would place **duplicate
copy-trade orders**.

---

## First-time setup (one-time)

Run these as `root` (or with `sudo`), then switch to the `kopix` user for the
last few steps.

### 1. Install system dependencies

```bash
apt update
apt install -y curl git ca-certificates gnupg

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Caddy (auto-TLS via Let's Encrypt)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Docker (only for pg + redis)
apt install -y docker.io docker-compose-plugin

# pm2 globally
npm install -g pm2
```

### 2. Create the `kopix` user + clone

```bash
useradd -m -s /bin/bash kopix
usermod -aG docker kopix
su - kopix

git clone https://github.com/chigerartem/KopiX.git /opt/kopix
cd /opt/kopix
```

### 3. Write `.env` (plain file, 600)

```bash
cp .env.example .env      # or create from scratch
chmod 600 .env
```

Required variables (no base64, no secret blobs):

| Variable              | Example                                              |
|-----------------------|------------------------------------------------------|
| `DATABASE_URL`        | `postgresql://kopix:<pw>@127.0.0.1:5432/kopix`       |
| `REDIS_URL`           | `redis://127.0.0.1:6379`                             |
| `APP_ENCRYPTION_KEY`  | 32-byte hex (see `infra/scripts/mk-secret.sh`)       |
| `TELEGRAM_BOT_TOKEN`  | from @BotFather                                      |
| `BOT_WEBHOOK_SECRET`  | random 32+ chars                                     |
| `APP_DOMAIN`          | `kopix.example.com`                                  |
| `MINIAPP_URL`         | `https://kopix.example.com`                          |
| `CRYPTOBOT_TOKEN`     | from @CryptoBot                                      |
| `MASTER_BINGX_API_KEY` / `MASTER_BINGX_SECRET` | master trader BingX keys       |

`COMMIT_SHA` is appended by `scripts/deploy.sh` automatically — do not set it
by hand.

### 4. Start pg + redis

```bash
cd /opt/kopix
docker compose -f infra/compose/docker-compose.data.yml up -d
docker compose -f infra/compose/docker-compose.data.yml ps
```

### 5. Install + build + migrate

```bash
npm ci
npm run build
npm run db:migrate
```

### 6. Install Caddy config

```bash
sudo cp infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Replace APP_DOMAIN token in the Caddyfile if not already substituted.
sudo systemctl reload caddy
```

Caddy will request a Let's Encrypt certificate on first request to
`https://APP_DOMAIN/`.

### 7. Start pm2 + persist across reboots

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u kopix --hp /home/kopix    # prints a sudo command — run it
```

### 8. Register the Telegram webhook

```bash
npm run webhook:register
```

Idempotent — re-running with a new `COMMIT_SHA` just updates the URL.

---

## Daily workflow — deploys

From the VPS:

```bash
ssh kopix@vps
cd /opt/kopix
./scripts/deploy.sh
```

One-liner from laptop:

```bash
ssh kopix@vps 'cd /opt/kopix && ./scripts/deploy.sh'
```

The script runs:

```
git fetch && git pull
export COMMIT_SHA=<git rev-parse HEAD>   # persisted to .env
npm ci                                   # no-op if lockfile unchanged
npm run build                            # turbo: only rebuilds changed
npm run db:migrate                       # prisma migrate deploy (idempotent)
pm2 reload ecosystem.config.cjs --update-env
npm run webhook:register                 # updates MINIAPP_URL?v=<sha>
```

Zero-ish-downtime — pm2 reload does rolling restart of api + bot, then engine.
Telegram retries webhook deliveries during the second or two the bot restarts.

---

## CI

`.github/workflows/ci.yml` runs on every PR and on `main` push:

```
npm ci → db:generate → db:migrate → typecheck → lint → test
```

That is the **entire** CI surface. No image builds, no deploy job. Deploys are
always a human decision on the VPS.

---

## Rollback

```bash
cd /opt/kopix
git log --oneline -n 10
git checkout <previous-sha>
./scripts/deploy.sh
```

If you rolled over a forward-only Prisma migration you need to restore the last
pg dump first — see [RUNBOOK.md](RUNBOOK.md#db-backup--restore).

---

## Why no Docker for apps?

- Deploys used to route through 4 image builds → GHCR → SCP → SSH →
  `docker compose up`. Three of the last six commits on `main` were fixes to
  this layer.
- Secrets were hidden inside a base64 blob (`PROD_ENV_B64`). The
  `WEBHOOK_SECRET` vs `BOT_WEBHOOK_SECRET` incident was a direct consequence.
- pm2 + native Node is simpler, faster, and lets `git pull && reload` work
  without CI involvement.

Postgres and Redis stay in Docker because installing them from apt on every new
VPS and managing `pg_hba.conf` / `appendonly.aof` by hand isn't worth the
marginal simplification.
