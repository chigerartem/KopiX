# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

KopiX is a **copy-trading product** — one master trader on BingX, subscribers copy their trades automatically. Subscribers interact via Telegram bot + Telegram Mini App. Payments via CryptoBot.

The immediate goal is a complete, production-grade standalone product. White-label multi-client automation is a future phase.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture — it is the source of truth.

## Repository

- Remote: https://github.com/chigerartem/KopiX.git
- Default branch for PRs: `main`
- Active development branch: `dev`

## Stack

- **Language**: TypeScript / Node.js 22 LTS (all apps and packages)
- **Monorepo**: npm workspaces + Turborepo
- **API**: Fastify + Zod
- **Bot**: grammY (Telegram)
- **Frontend**: React 19 + Vite 6 + CSS Modules (design tokens in `apps/miniapp/src/styles/global.css`)
- **ORM**: Prisma (PostgreSQL 16)
- **Cache/Queue**: Redis 7 (Redis Streams for trade signals; pub/sub for live trade events)
- **Exchange**: BingX Perpetual Futures via ccxt
- **Deployment**: pm2 on host + Caddy (TLS / reverse proxy) + Docker Compose for the data layer (Postgres 16 + Redis 7) via `infra/compose/docker-compose.data.yml`

## Surface split

- **Mini App** owns every interactive flow: dashboard, BingX API key (add / disconnect), copy settings (mode + sizing + pause/resume), subscription purchase (CryptoBot invoice).
- **Bot** is read-only: `/start` shows an EN intro + "Open Mini App" button, `/status` / `/dashboard` / `/pause` / `/resume` are informational. The bot also pushes per-subscriber trade notifications (open / close, full data) — see `apps/bot/src/services/tradeNotifier.ts`.

## Monorepo Layout

```
apps/api        → Fastify REST API
apps/bot        → Telegram bot (grammY)
apps/engine     → Copy trading engine (master watcher + signal executor)
apps/miniapp    → React + Vite Telegram Mini App
packages/shared → Shared types, enums, DTOs
packages/db     → Prisma schema + client
packages/exchange → ccxt BingX adapter (validateCredentials, placeMarketOrder, subscribeToPositions)
packages/crypto → AES-256-GCM encrypt/decrypt for API keys
infra/docker    → Dockerfiles per service
infra/compose   → Docker Compose (dev + prod)
infra/k8s       → Kubernetes manifests (single-namespace alternative)
```

## Key Architecture Rules

- **One trade engine instance** — never run multiple replicas. Parallelism causes duplicate orders.
- **API keys always encrypted** — AES-256-GCM, key from env var `APP_ENCRYPTION_KEY`. Never log, never return in API responses.
- **Subscriber keys must be trade-only** — validate at `POST /api/exchange/validate` that withdraw permission is absent. Reject otherwise.
- **Idempotent trade execution** — check `copied_trades` for existing `(signal_id, subscriber_id)` before placing any order.
- **Redis Streams for signals** — consumer groups for at-least-once delivery + crash recovery.
- **API keys are entered in the Mini App, never the bot** — the bot has no chat-based key flow, so we don't need to delete chat messages containing secrets.
- **White-label is future** — do not add multi-client, provisioning, or control plane code now.

## Commands

### Local dev
- `npm install` — install all workspaces
- `npm run dev` — turbo pipeline (api + bot + engine + miniapp Vite)
- `npm run typecheck` — `tsc --noEmit` across workspaces
- `npm run build` — turbo build all apps
- `npm run test` — run test suites

### Database
- `npm run db:migrate` — `prisma migrate deploy`
- `npm run db:generate` — regenerate Prisma client
- `npm run db:studio` — open Prisma Studio

### Data layer (Postgres + Redis in Docker)
- `docker compose -f infra/compose/docker-compose.data.yml up -d` — start pg + redis
- `docker compose -f infra/compose/docker-compose.data.yml ps` — check status
- `docker compose -f infra/compose/docker-compose.data.yml logs -f redis` — tail redis

### Deploy to VPS (pm2 + Caddy)
- `bash scripts/deploy.sh` — git pull + `npm ci` + build + `prisma migrate deploy` + `pm2 reload all`
- `pm2 logs <kopix-api|kopix-bot|kopix-engine>` — tail a service
- `pm2 restart kopix-engine` — restart a single service (engine is a singleton — do **not** scale)
- `pm2 reload kopix-api` — zero-downtime reload of the API
- Caddy serves the miniapp static build and reverse-proxies the API + bot webhook on the host

### Telegram webhook
- `node scripts/register-webhook.ts` — idempotent `setWebhook` with `?v=<commit-sha>` cache buster
