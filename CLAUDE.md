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
- **Frontend**: React 19 + Vite 6 + Tailwind CSS 4
- **ORM**: Prisma (PostgreSQL 16)
- **Cache/Queue**: Redis 7 (Redis Streams for trade signals)
- **Exchange**: BingX Perpetual Futures via ccxt
- **Deployment**: Docker Compose (default) or Kubernetes single namespace

## Monorepo Layout (planned)

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
- **Subscriber keys must be trade-only** — validate at `/connect` that withdraw permission is absent. Reject otherwise.
- **Idempotent trade execution** — check `copied_trades` for existing `(signal_id, subscriber_id)` before placing any order.
- **Redis Streams for signals** — consumer groups for at-least-once delivery + crash recovery.
- **Delete bot messages containing API keys** — call `deleteMessage` immediately after capturing key and secret.
- **White-label is future** — do not add multi-client, provisioning, or control plane code now.

## Commands

> To be populated once the monorepo is initialized.
