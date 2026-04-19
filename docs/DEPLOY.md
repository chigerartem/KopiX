# KopiX — Production Deployment Guide

After following this guide the app will run permanently on your VPS, update automatically on every push to `main`, and the Telegram Mini App will always serve the current build.

---

## Architecture

```
GitHub push → Actions builds 4 images → pushes to ghcr.io → SSH into VPS
  → docker compose pull → docker compose up -d
  → registers Telegram webhook automatically

VPS (Kedserver / any Ubuntu VPS):
  Caddy (443/80) ─┬─ /api/bot/webhook → bot:3001 (grammY)
                  ├─ /api/*          → api:3000 (Fastify)
                  └─ /*              → miniapp:80 (nginx static)
```

No local machine needed after the first setup.

---

## Step 1 — Prepare the VPS

SSH into your server as root, then run the setup script:

```bash
curl -fsSL https://raw.githubusercontent.com/chigerartem/KopiX/main/infra/scripts/server-setup.sh | sh
```

The script:
- Installs Docker + Docker Compose plugin
- Opens ports 80/443 in the firewall
- Generates an SSH deploy key pair and prints the **private** key

> **Copy the private key** — you need it for Step 3.

---

## Step 2 — Create the production `.env`

On your **local machine**, in the repo root:

```bash
cp infra/compose/.env.example infra/compose/.env
```

Open `infra/compose/.env` and fill in every value. Generate secrets where noted:

```bash
# 32-byte AES key for APP_ENCRYPTION_KEY
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"

# Random passwords / tokens
openssl rand -hex 32
```

Then encode it for GitHub:

```bash
sh infra/scripts/mk-secret.sh
# copy the printed base64 string
```

> **Do not commit `infra/compose/.env`** — it is in `.gitignore`.

---

## Step 3 — Configure GitHub Secrets

Go to **GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret**.

| Secret name         | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| `DEPLOY_HOST`       | VPS IP address or hostname                                                    |
| `DEPLOY_USER`       | SSH user (usually `root`)                                                     |
| `DEPLOY_SSH_KEY`    | Private SSH key printed by `server-setup.sh` (include `-----BEGIN...-----`)  |
| `PROD_ENV_B64`      | Output of `mk-secret.sh`                                                      |
| `GHCR_PAT`          | GitHub Personal Access Token with **`read:packages`** scope (see below)       |
| `APP_DOMAIN`        | Your domain, e.g. `kopix.example.com` (no `https://`)                        |
| `TELEGRAM_BOT_TOKEN`| Your bot token from @BotFather                                                |
| `BOT_WEBHOOK_SECRET`| Same random value as `BOT_WEBHOOK_SECRET` in your `.env`                     |

### Creating `GHCR_PAT`

1. GitHub → your profile → **Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. **Generate new token (classic)**
3. Scopes: tick **`read:packages`** only
4. Copy the token → paste as `GHCR_PAT` secret

---

## Step 4 — Point your domain at the VPS

In your DNS provider, add an **A record**:

```
kopix.example.com  →  <VPS IP>
```

TTL 300s (5 min) while you're setting up, switch to 3600 after.

Caddy will obtain a Let's Encrypt certificate automatically when it first
receives traffic on port 443. No manual certificate handling needed.

---

## Step 5 — First deploy

```bash
# Make sure you're on the main branch with all changes committed
git checkout main
git merge dev          # or cherry-pick your commits
git push origin main
```

GitHub Actions will:
1. Build all 4 Docker images in parallel (~3–5 min)
2. Push them to `ghcr.io`
3. SSH into the VPS, pull the images, restart the stack
4. Register the Telegram bot webhook at `https://YOUR_DOMAIN/api/bot/webhook`

Watch the progress: **GitHub → Actions → Build & Deploy**.

---

## Step 6 — Verify

```bash
# API alive
curl -s https://YOUR_DOMAIN/health/live | jq

# Mini App reachable (should return HTML)
curl -s https://YOUR_DOMAIN | head -5

# Bot webhook registered
curl -s "https://api.telegram.org/botYOUR_TOKEN/getWebhookInfo" | jq .result.url
# should print: "https://YOUR_DOMAIN/api/bot/webhook"

# All containers running
ssh root@YOUR_VPS "cd /opt/kopix && docker compose -f infra/compose/docker-compose.prod.yml ps"
```

---

## Ongoing workflow

Every push to `main` triggers a full redeploy. No SSH needed.

```bash
# Normal dev workflow
git checkout dev
# ... make changes ...
git commit -m "feat: ..."
git push origin dev

# When ready to ship
git checkout main
git merge dev
git push origin main   # → triggers deploy automatically
```

---

## Troubleshooting

### Mini App shows old version

The Mini App is a static build baked into the `miniapp` Docker image. If you
see an old version:

1. Check that the Actions run succeeded: **GitHub → Actions**
2. Confirm the container is running the new image:
   ```bash
   ssh root@VPS "docker inspect kopix-miniapp-1 | grep Image"
   ```
3. Force-clear Telegram's cached webview: in Telegram → bot chat →
   **⋮ menu → Clear cache** (varies by platform).

### Bot not responding

```bash
# Check webhook is registered
curl "https://api.telegram.org/botTOKEN/getWebhookInfo"

# Check bot logs
ssh root@VPS "cd /opt/kopix && docker compose -f infra/compose/docker-compose.prod.yml logs --tail=100 bot"
```

### Cert not issued (HTTPS fails)

- DNS must propagate before Caddy can get a cert. Check: `dig +short YOUR_DOMAIN`
- Ports 80 and 443 must be open on the VPS firewall
- Caddy logs: `docker compose logs caddy`

### Engine not connecting to BingX

- Check `MASTER_API_KEY` / `MASTER_API_SECRET` in `.env`
- Verify the BingX API key has **Futures trading** permission and the IP
  whitelist includes the VPS IP
- `docker compose logs --tail=200 engine | grep -E 'watcher|listenKey'`

---

## Secrets rotation

See `docs/RUNBOOK.md` § 6 for procedures on rotating secrets without downtime.
