# KopiX — Production Architecture Document

> Version: 2.0 — April 2026
> Status: Authoritative design reference

---

## Priority Statement

**The immediate goal is to ship one fully working, production-grade copy-trading product.**

White-label packaging, automated multi-client provisioning, and fleet management are explicitly deferred to a later phase. Every decision in this document is made in service of building a single reliable product first. The architecture is designed to support white-label extraction later without requiring a rewrite, but none of that infrastructure is built now.

---

## 1. Product Definition

KopiX is a **copy-trading service** delivered as a single production application. One master trader connects their BingX account via API key. Subscribers pay a recurring subscription fee and have their own BingX trades automatically executed when the master trades. The entire subscriber experience runs through Telegram — a bot for onboarding and commands, and a Telegram Mini App for the dashboard and settings.

The product is deployed once, runs on a single domain, and serves one master trader and their subscriber base. It is production-first: built to handle real load, real money, and real exchange API behavior from day one.

KopiX has no marketplace, no multi-trader model, and no social feed. It is a focused execution product.

### What this product is not (yet)
The vision for KopiX includes a white-label platform where multiple business clients can each run their own isolated copy-trading deployment under their own brand. That is a real future direction — but it requires a working, battle-tested product to license first. Multi-client provisioning, control plane orchestration, and fleet management are covered in §23 (Future: White-Label Platform).

---

## 2. Business Model

| Role | Actor | Revenue source |
|---|---|---|
| Operator | Owner of this KopiX deployment | Subscription fees from subscribers |
| Subscriber | End user | Pays subscription fee in crypto to copy the master |
| Master Trader | The trader being copied | Access to followers; may receive a share of fees |

- The operator collects subscription fees directly via CryptoBot into their own crypto wallet.
- No intermediary takes a cut from subscriber payments at this stage.
- Subscribers pay per period (monthly or custom duration).

---

## 3. User Roles

### 3.1 Operator / Admin
- Owns and operates the KopiX deployment.
- Configures the master trader's BingX API key.
- Sets subscription plan pricing and duration.
- Accesses deployment metrics and logs.
- There is no user-facing admin panel in Phase 1 — configuration is done via environment variables and a simple internal API.

### 3.2 Master Trader
- One per deployment.
- Connects their BingX perpetual futures account via API key + secret.
- Trades normally — KopiX monitors their account and replicates positions.
- Has no interaction with KopiX's UI; their trading is observed transparently.
- Their API key must have trade permissions only, never withdrawal.

### 3.3 Subscriber
- End user who pays to copy the master trader.
- Interacts via the Telegram bot and Telegram Mini App.
- Connects their own BingX account via API key + secret.
- Selects a copy mode (fixed or percentage) and activates a subscription.
- Their orders are placed automatically by the trade engine on each master signal.

---

## 4. System Boundaries

```
┌──────────────────────────────────────────────┐
│  KopiX Application                           │
│                                              │
│  api-server   trade-engine   telegram-bot    │
│  mini-app     postgresql     redis           │
└──────────────────────────────────────────────┘
         │
         ├── BingX REST + WebSocket API
         │     (master account: position stream)
         │     (subscriber accounts: order placement)
         │
         ├── Telegram Bot API
         │     (webhook for bot commands)
         │
         ├── Telegram Web App SDK
         │     (mini app auth and UI bridge)
         │
         ├── CryptoBot API (pay.crypt.bot)
         │     (invoice creation, payment webhooks)
         │
         └── DNS + Let's Encrypt
               (operator's domain, automatic SSL)
```

**KopiX never holds funds.** Subscribers connect their own BingX accounts. The master connects their own account. CryptoBot payments go to the operator's wallet, not through KopiX.

---

## 5. High-Level Architecture

KopiX is a single **multi-service application** deployed on one server or Kubernetes namespace. There is no control plane, no multi-tenant routing, and no namespace-per-client.

### 5.1 Services

```
┌──────────────────────────────────────────────────────┐
│  Application                                         │
│                                                      │
│  ┌──────────────┐   ┌──────────────────────────┐    │
│  │  api-server  │   │  trade-engine             │    │
│  │  (Fastify)   │   │  (copy trading daemon)    │    │
│  └──────┬───────┘   └─────────────┬────────────┘    │
│         │                         │                  │
│  ┌──────┴───────┐   ┌─────────────┴────────────┐    │
│  │ telegram-bot │   │  postgresql               │    │
│  │  (grammY)    │   │  (primary datastore)      │    │
│  └──────┬───────┘   └─────────────┬────────────┘    │
│         │                         │                  │
│  ┌──────┴───────┐   ┌─────────────┴────────────┐    │
│  │  mini-app    │   │  redis                    │    │
│  │  (nginx)     │   │  (streams + pub/sub)      │    │
│  └──────────────┘   └──────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

- **api-server**: REST API for mini app and bot. Handles auth, subscriptions, exchange connect, trade history, payment webhooks, SSE stream.
- **trade-engine**: Long-running daemon. Maintains WebSocket connection to master's BingX account. Publishes trade signals to Redis Streams. Consumes signals and places orders for each subscriber.
- **telegram-bot**: Handles all bot commands and conversations via webhook.
- **mini-app**: Static React SPA served by nginx. Authenticated via Telegram Web App initData.
- **postgresql**: Single database. All application state lives here.
- **redis**: Trade signal queue (Redis Streams), pub/sub for real-time events, rate-limiting state.

### 5.2 Service Communication

- `telegram-bot` → `api-server`: HTTP (internal)
- `api-server` → `postgresql`: Prisma client
- `api-server` → `redis`: ioredis
- `trade-engine` → `postgresql`: Prisma client
- `trade-engine` → `redis`: publishes to streams, subscribes to pub/sub
- `api-server` → `redis`: subscribes to pub/sub for SSE delivery
- All external traffic enters through nginx reverse proxy (HTTPS)

### 5.3 Monorepo Structure

```
kopix/
├── apps/
│   ├── api/            → Fastify REST API
│   ├── bot/            → Telegram bot (grammY)
│   ├── engine/         → Copy trading engine
│   └── miniapp/        → React + Vite mini app
├── packages/
│   ├── shared/         → Shared types, utilities, DTOs
│   ├── db/             → Prisma schema + client
│   ├── exchange/       → BingX adapter (ccxt wrapper)
│   └── crypto/         → AES-256-GCM encryption utility
├── infra/
│   ├── docker/         → Dockerfiles per service
│   ├── compose/        → Docker Compose (local dev + production)
│   └── k8s/            → Kubernetes manifests (single-app deployment)
├── docs/               → Architecture, runbooks
└── .github/workflows/  → CI/CD
```

---

## 6. Technology Stack

All decisions are deliberate. Rationale included.

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript (Node.js 22 LTS)** | Async-first runtime fits WebSocket-heavy workload; strong Telegram/exchange SDK ecosystem; one language across all services |
| API framework | **Fastify** | Fastest Node.js HTTP framework; built-in JSON schema validation; Zod integration; good plugin ecosystem |
| Bot framework | **grammY** | Modern, TypeScript-native, well-maintained; superior to Telegraf for new projects |
| Frontend | **React 19 + Vite 6** | Industry standard; best ecosystem for Telegram Web App SDK integration |
| Styling | **Tailwind CSS 4** | Rapid development; minimal production bundle |
| ORM | **Prisma** | Type-safe schema-first ORM; excellent migration tooling; PostgreSQL-native |
| Database | **PostgreSQL 16** | ACID-compliant; reliable; proven at scale; excellent JSON support for trade metadata |
| Cache/Queue | **Redis 7** | Redis Streams for durable trade signal queue with consumer groups; pub/sub for real-time events |
| Exchange SDK | **ccxt (Node.js)** | Unified multi-exchange API; supports BingX; handles rate limiting and normalization |
| Container runtime | **Docker + Docker Compose** | Simple, reproducible deployment for a single-app product |
| Production orchestration | **Kubernetes (single namespace)** | Used for production reliability — probes, restarts, rolling updates, resource limits |
| Ingress | **nginx** | Reverse proxy; TLS termination; serves mini-app static files |
| SSL | **cert-manager + Let's Encrypt** | Automated certificate provisioning and renewal |
| Metrics | **Prometheus + Grafana** | Industry standard observability |
| Logs | **Pino → stdout → Loki** | Structured JSON logs; log aggregation via Loki |
| Alerts | **Alertmanager** | Prometheus-native; routes to Slack/PagerDuty |
| CI/CD | **GitHub Actions** | Builds Docker images, runs tests, deploys on push to main |

**Why not Python?** Node.js offers better async I/O primitives for high-concurrency WebSocket workloads, same-language across all services, and a stronger Telegram library ecosystem.

**Why not Kafka/RabbitMQ?** Redis Streams provides durable pub/sub with consumer groups and replay capability — sufficient for this workload, zero additional infrastructure.

**Why Docker Compose for production?** KopiX is a single-product deployment at this stage. Docker Compose on a single VPS or small VM is operationally simple and perfectly capable for hundreds of subscribers. Kubernetes manifests are available for operators who prefer it, but the default path is Compose.

---

## 7. BingX Integration

BingX is the exchange for Phase 1. The integration covers perpetual futures (swap accounts).

### 7.1 API Overview

- **REST API**: `https://open-api.bingx.com`
- **WebSocket**: `wss://open-api-ws.bingx.com/market`
- **Private streams**: Require a listen key (obtained via REST, valid 60 minutes, refreshed every 30 minutes)
- **ccxt ID**: `bingx`

### 7.2 Listen Key Flow (Master Account Watcher)

```
1. POST /openApi/user/auth/userDataStream
   → Returns listenKey (valid 60 min)

2. Open WebSocket: wss://open-api-ws.bingx.com/market?listenKey={key}

3. Receive account update events:
   - ORDER_TRADE_UPDATE  → order filled/cancelled
   - ACCOUNT_UPDATE     → balance change
   - Position snapshots on connect

4. Every 30 minutes:
   PUT /openApi/user/auth/userDataStream → extend listenKey

5. On disconnect: reconnect with backoff, re-fetch listenKey
```

### 7.3 Order Placement (Subscriber Execution)

BingX perpetual futures order via ccxt:
```
exchange.createOrder(
  symbol,        // e.g. "BTC/USDT:USDT"
  type,          // "market"
  side,          // "buy" | "sell"
  amount,        // in contract units (calculated from USDT size / contract size)
  undefined,     // price (not needed for market orders)
  { positionSide: "LONG" | "SHORT" }  // required for hedge mode
)
```

**Position mode**: BingX supports both one-way and hedge mode. The system assumes hedge mode (separate LONG/SHORT positions), which is typical for copy trading setups. Validate at API key connection time and reject keys that are configured for one-way mode (or handle both, TBD).

### 7.4 BingX-Specific Constraints

- **Minimum order size**: Varies by contract (typically 1 contract = $1–$5 in USDT). Skip orders below minimum.
- **Rate limits**: 100 orders/10s per account. Each subscriber has their own account/limit. Safe.
- **Futures account**: Subscriber must have a perpetual futures (swap) account with balance. Validate on connect.
- **Leverage**: Not managed by KopiX. Subscribers set their own leverage. This is intentional — leverage is a subscriber's risk decision.
- **Margin type**: Isolated vs cross. Not managed by KopiX. Subscribers configure their own.

### 7.5 ccxt Wrapper (`packages/exchange`)

```typescript
// Exported interface — implementation behind this never leaks BingX specifics
interface ExchangeAdapter {
  validateCredentials(key: string, secret: string): Promise<ValidationResult>
  getBalance(credentials: Credentials): Promise<Balance>
  placeMarketOrder(credentials: Credentials, order: OrderParams): Promise<OrderResult>
  subscribeToMasterPositions(credentials: Credentials, onSignal: SignalHandler): () => void
}
```

This abstraction is what makes future exchange support (Bybit, OKX) a drop-in addition without touching the engine or API server.

---

## 8. Application Lifecycle (Single Deployment)

```
1. Operator provisions server (VPS or Kubernetes)
2. Operator sets environment variables:
   - DATABASE_URL, REDIS_URL
   - TELEGRAM_BOT_TOKEN
   - CRYPTOBOT_API_TOKEN
   - MASTER_API_KEY, MASTER_API_SECRET (BingX)
   - APP_ENCRYPTION_KEY (32-byte random, for AES-256-GCM)
   - APP_DOMAIN (e.g. copy.yourdomain.com)
3. docker compose up -d (or kubectl apply -f infra/k8s/)
4. Prisma migrations run automatically on api-server startup
5. Operator points domain DNS A record → server IP
6. cert-manager issues SSL certificate automatically
7. Operator registers bot webhook:
   POST https://api.telegram.org/bot{TOKEN}/setWebhook
   { url: "https://copy.yourdomain.com/api/bot/webhook" }
8. Trade engine connects to master's BingX account via WebSocket
9. Product is live — subscribers can now onboard via Telegram

Ongoing:
- Deploy updates: docker compose pull && docker compose up -d
- Monitor: Grafana at /grafana (basic auth protected)
- Logs: docker compose logs -f engine
- DB backup: pg_dump runs daily via cron, uploads to S3
```

---

## 9. Runtime Flow (Normal Operation)

```
Master Trader makes a trade on BingX
        │
        ▼
Trade Engine (WebSocket listener)
receives ORDER_TRADE_UPDATE event
        │
        ▼
Signal normalized and published to Redis Stream: "trade-signals"
{ id, symbol, side, signalType, masterPrice, masterSize,
  masterPositionId, timestamp }
        │
        ▼
Trade Engine (signal consumer, same process)
reads from stream via consumer group
        │
        ├── For each ACTIVE subscriber:
        │     1. Check subscription is valid and not expired
        │     2. Decrypt subscriber BingX credentials
        │     3. Calculate trade size (see §10)
        │     4. Check subscriber balance ≥ minimum order size
        │     5. Place market order via BingX API (ccxt)
        │     6. Record result in copied_trades table
        │     7. Update positions table
        │     8. Publish to Redis pub/sub: "trades:{subscriberId}"
        │
        └── Acknowledge stream entry when all subscribers processed

API Server (SSE handler)
subscribed to Redis pub/sub
→ pushes events to connected Mini App clients
```

---

## 10. Copy Trading Flow

### 10.1 Copy Modes

**Mode A: Fixed Amount**
- Subscriber sets a fixed USDT notional per trade (e.g., $50).
- Every signal triggers a trade sized to exactly $50 regardless of the master's position size.
- Example: master opens $20,000 BTC long → subscriber opens $50 BTC long.
- Predictable, safe for small accounts.

**Mode B: Percentage of Deposit**
- Subscriber sets a percentage of their available balance (e.g., 5%).
- System fetches subscriber's current balance, calculates: `balance × percentage / 100`.
- Example: subscriber has $2,000, sets 5% → trades $100 per signal.
- Scales proportionally as the account grows or shrinks.

### 10.2 Trade Size Calculation

```
function calculateOrderSize(subscriber, signal, exchange):
  if subscriber.copyMode == FIXED:
    usdtSize = subscriber.fixedAmount

  if subscriber.copyMode == PERCENTAGE:
    balance = await exchange.getBalance(subscriber.credentials)
    usdtSize = balance.available * (subscriber.percentage / 100)

  contractSize = usdtSize / exchange.getContractValue(signal.symbol)
  contractSize = floor(contractSize)  // round down to whole contracts

  if contractSize < exchange.getMinimumOrderSize(signal.symbol):
    return { skip: true, reason: "below_minimum" }

  if subscriber.maxPositionUsdt && usdtSize > subscriber.maxPositionUsdt:
    usdtSize = subscriber.maxPositionUsdt
    contractSize = floor(usdtSize / exchange.getContractValue(signal.symbol))

  return { contractSize, estimatedUsdt: usdtSize }
```

### 10.3 Signal Types

| Signal | Trigger | Subscriber action |
|---|---|---|
| `OPEN_LONG` | Master opens long position | Open long |
| `OPEN_SHORT` | Master opens short position | Open short |
| `CLOSE_LONG` | Master fully closes long | Close matching long position |
| `CLOSE_SHORT` | Master fully closes short | Close matching short position |
| `INCREASE_LONG` | Master adds to long | Add to long proportionally |
| `INCREASE_SHORT` | Master adds to short | Add to short proportionally |
| `DECREASE_LONG` | Master partially closes long | Partially close long |
| `DECREASE_SHORT` | Master partially closes short | Partially close short |

### 10.4 Position Matching

When the master closes a position, subscribers must close the matching position they opened. Matching is done by `open_signal_id`:

```
Subscriber's open position has open_signal_id = "sig_abc"
Master closes position → CLOSE_LONG signal emitted with same master_position_id

Engine:
  1. Find all subscriber positions where open_signal_id matches
     AND symbol matches AND side = 'long' AND status = 'open'
  2. Place close orders for each
  3. Update position status to 'closed', record exit_price, realized_pnl
```

### 10.5 Failure Handling in Execution

```
Order placement fails:
  → Log with full context (subscriberId, signalId, error)
  → Retry 3× with exponential backoff: 200ms, 1s, 4s
  → After 3 failures: mark copied_trade.status = 'failed', record failure_reason
  → If failure rate > 5% in 5 minutes: fire MasterExecutionAlert

Insufficient balance:
  → Skip immediately, no retry
  → Mark as 'skipped', reason = 'insufficient_balance'
  → Send bot notification to subscriber

Invalid API key (401/403):
  → Skip trade, pause subscriber, set subscriber.status = 'suspended'
  → Bot message: "Your BingX API key is invalid. Please reconnect via /connect"

Exchange rate limit hit:
  → ccxt handles per-exchange rate limit with built-in queue (rateLimit: true)
  → If systemic: log, monitor, reduce concurrency

Exchange WebSocket disconnected:
  → Reconnect with backoff: 1s, 5s, 30s, 5min
  → Do not emit signals during disconnect
  → Alert admin after 60s of downtime
```

### 10.6 Slippage Tracking

```
slippage_pct = abs(executedPrice - masterPrice) / masterPrice * 100
```

Stored per trade. Displayed in subscriber's trade history and available in monitoring dashboards. High slippage is expected during volatile moments — it is tracked, not prevented.

### 10.7 Concurrency Model

The engine processes one signal at a time (strictly ordered). Within each signal, subscriber orders are executed with **controlled concurrency**:

```typescript
const CONCURRENCY = 20  // max parallel order placements per signal

async function processSignal(signal: TradeSignal, subscribers: Subscriber[]) {
  const semaphore = new Semaphore(CONCURRENCY)
  await Promise.allSettled(
    subscribers.map(sub => semaphore.run(() => executeForSubscriber(signal, sub)))
  )
  await redis.xack('trade-signals', 'engine-group', signal.streamId)
}
```

Each subscriber uses their own API key, so they operate in separate rate-limit buckets. 20 parallel placements is safe.

---

## 11. Payment Flow

**Choice: CryptoBot (`pay.crypt.bot`)**

Rationale: Native Telegram integration, no browser redirect needed, supports USDT/BTC/ETH/TON/other, webhook confirmation, simple API, no KYC friction, operator receives funds directly to their own CryptoBot wallet.

### 11.1 Invoice Creation

```
Subscriber selects plan in Mini App
        │
        ▼
POST /api/subscriptions/create-invoice
{ planId }
Authorization: TMA {initData}
        │
        ▼
API creates invoice via CryptoBot:
POST https://pay.crypt.bot/api/createInvoice
{
  asset: "USDT",
  amount: plan.price,
  description: "KopiX Subscription — {plan.name}",
  payload: "{subscriberId}:{planId}:{nonce}",
  paid_btn_name: "callback",
  paid_btn_url: "https://{domain}/payment-success"
}
        │
        ▼
Returns mini_app_invoice_url
        │
        ▼
Mini App calls Telegram.WebApp.openInvoice(mini_app_invoice_url)
Telegram handles the payment UI natively
```

### 11.2 Payment Confirmation

```
Subscriber completes payment via @CryptoBot
        │
        ▼
CryptoBot POSTs webhook to:
https://{domain}/api/webhooks/cryptobot
{
  update_type: "invoice_paid",
  payload: { invoice_id, status: "paid", payload: "{sub}:{plan}:{nonce}" }
}
        │
        ▼
API verifies HMAC-SHA-256 (X-Crypto-Pay-Api-Signature header)
If invalid: return 400, log attempted forgery
        │
        ▼
Idempotency check: has this invoice_id already been processed?
If yes: return 200 (CryptoBot may retry)
        │
        ▼
Create/extend subscription:
{
  subscriber_id, plan_id,
  status: 'active',
  started_at: now(),
  expires_at: now() + plan.duration_days * 86400s,
  cryptobot_invoice_id: invoice_id,
  amount_paid: invoice.amount, currency: invoice.asset
}
        │
        ▼
Set subscriber.status = 'active' (if it was inactive)
Engine picks up subscriber on next signal
        │
        ▼
Bot sends confirmation message to subscriber
```

### 11.3 Subscription Expiry

- Background cron in `api-server` runs every 15 minutes.
- Queries: `SELECT * FROM subscriptions WHERE expires_at < NOW() AND status = 'active'`
- For each: set status = 'expired', set subscriber.status = 'inactive'.
- Engine skips subscribers with status != 'active'.
- Bot notification schedule: 24h before expiry, 1h before expiry, on expiry.

---

## 12. Domain and SSL Flow

### 12.1 One-time setup

1. Operator purchases domain (e.g., `copy.yourbrand.com`).
2. Operator sets DNS A record: `copy.yourbrand.com → <server IP>`.
3. Operator sets `APP_DOMAIN=copy.yourbrand.com` in environment.

### 12.2 Automated SSL

cert-manager watches for Ingress resources with the `cert-manager.io/cluster-issuer: letsencrypt-prod` annotation. On creation it:
1. Issues ACME HTTP-01 challenge via the nginx ingress.
2. Obtains certificate from Let's Encrypt.
3. Stores it in a Kubernetes Secret (or Docker volume).
4. Renews automatically 30 days before expiry.

For Docker Compose deployments, Caddy is an alternative to nginx + cert-manager — it handles SSL automatically with zero configuration:
```yaml
caddy:
  image: caddy:2-alpine
  ports: ["80:80", "443:443"]
  command: caddy reverse-proxy --from copy.yourbrand.com --to api:3000
```

### 12.3 Nginx routing (Kubernetes / manual nginx setup)

```nginx
server {
  listen 443 ssl;
  server_name copy.yourbrand.com;

  location /api {
    proxy_pass http://api-server:3000;
  }

  location /api/stream {
    proxy_pass http://api-server:3000;
    proxy_buffering off;          # required for SSE
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
  }

  location /api/bot/webhook {
    proxy_pass http://telegram-bot:3001;
  }

  location / {
    root /usr/share/nginx/html;   # mini-app static files
    try_files $uri $uri/ /index.html;
  }
}
```

### 12.4 Bot Webhook Registration

Run once after domain is live:
```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://copy.yourbrand.com/api/bot/webhook",
       "secret_token": "${BOT_WEBHOOK_SECRET}"}'
```

`BOT_WEBHOOK_SECRET` is validated on every incoming webhook request.

---

## 13. Telegram Bot Flow

### 13.1 Command Reference

| Command | Description |
|---|---|
| `/start` | Welcome, register if new user |
| `/connect` | Connect BingX account via API key |
| `/subscribe` | View plans and start payment |
| `/status` | Show subscription status and copy mode |
| `/mode` | Change copy mode (fixed/percentage) |
| `/pause` | Pause copying without cancelling subscription |
| `/resume` | Resume copying |
| `/dashboard` | Open Mini App |
| `/help` | Show command list |

### 13.2 Registration Flow

```
/start received
        │
        ▼
Check telegram_id in subscribers table
        │
   ┌────┴────┐
  NEW     EXISTING
   │           │
   ▼           ▼
INSERT      Show subscription
subscriber  status + dashboard
record      button
   │
   ▼
"Welcome! Connect your BingX account to get started → /connect"
```

### 13.3 Exchange Connection Flow

```
/connect received
        │
        ▼
Bot: "Please send your BingX API Key"
(force_reply: true)
        │
        ▼
User sends API Key
        │
        ▼
deleteMessage(apiKeyMessage)   ← remove from chat history
Bot: "Now send your API Secret"
        │
        ▼
User sends Secret
        │
        ▼
deleteMessage(secretMessage)   ← remove from chat history
        │
        ▼
API validates credentials:
  POST /api/exchange/validate
  { apiKey, apiSecret }
  → Calls BingX: fetch futures account balance
  → Checks: futures account exists, balance > 0
  → Checks: API permissions include trade, exclude withdraw
        │
   ┌────┴─────┐
  VALID    INVALID
   │            │
   ▼            ▼
Encrypt+     "Invalid key or
store creds  missing permissions.
             Try again."
   │
   ▼
"Connected! Choose a subscription plan → /subscribe"
```

**Security**: Keys encrypted (AES-256-GCM) immediately on receipt, before any DB write. Plaintext keys never leave the validation function scope. Chat messages containing keys are deleted immediately.

### 13.4 Webhook Architecture

- Webhook mode only (no polling in production).
- Validated via `X-Telegram-Bot-Api-Secret-Token` header on every request.
- Process in `apps/bot` (separate process from API server).
- For bot conversations needing database state (e.g., multi-step flows), use Redis to store conversation context keyed by `telegram_id`.

---

## 14. Mini App Flow

React SPA served by nginx at the app domain root. Opened via the `/dashboard` bot command or a persistent button in the bot menu.

### 14.1 Authentication

Telegram provides `window.Telegram.WebApp.initData` — a URL-encoded string including user info and an HMAC signature.

**Client-side**: send as `Authorization: TMA {initData}` on every API request.

**Server-side validation** (runs on every authenticated API request):
```typescript
function validateInitData(initData: string, botToken: string): TelegramUser {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secretKey = hmacSha256('WebAppData', botToken)
  const expectedHash = hmacSha256(dataCheckString, secretKey)

  if (expectedHash !== hash) throw new UnauthorizedError()

  const authDate = Number(params.get('auth_date'))
  if (Date.now() / 1000 - authDate > 300) throw new UnauthorizedError('Expired')

  return JSON.parse(params.get('user')!)
}
```

### 14.2 Pages

| Route | Content |
|---|---|
| `/` | Dashboard: subscription status, copy mode, total P&L, recent trades |
| `/connect` | BingX API key setup form |
| `/subscribe` | Plan selection + CryptoBot payment trigger |
| `/trades` | Full trade history (paginated, filterable) |
| `/settings` | Copy mode config (fixed amount / percentage), max position, pause/resume |
| `/payment-success` | Confirmation screen after successful payment |

### 14.3 Real-Time Updates

Mini App receives live trade events via **Server-Sent Events (SSE)**:

```
GET /api/stream/trades
Authorization: TMA {initData}
→ Content-Type: text/event-stream

Server pushes:
data: {"type":"trade_executed","symbol":"BTC/USDT","side":"buy","size":0.001,"pnl":null}
data: {"type":"position_closed","symbol":"BTC/USDT","realizedPnl":12.50}
```

Engine publishes to Redis pub/sub channel `trades:{subscriberId}` after each execution. API server's SSE handler subscribes and pushes to the open HTTP connection. No polling, no WebSocket complexity.

---

## 15. Deployment Model

### 15.1 Option A: Docker Compose (Default)

The default production deployment. Runs on a single VPS (minimum 2 vCPU, 4GB RAM, 40GB SSD). Suitable for hundreds of subscribers.

```yaml
# infra/compose/docker-compose.prod.yml
services:
  api:
    image: ghcr.io/org/kopix-api:${VERSION}
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://kopix:${DB_PASS}@postgres:5432/kopix
      REDIS_URL: redis://redis:6379
      BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY}
    depends_on: [postgres, redis]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]

  engine:
    image: ghcr.io/org/kopix-engine:${VERSION}
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://kopix:${DB_PASS}@postgres:5432/kopix
      REDIS_URL: redis://redis:6379
      ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY}
    depends_on: [postgres, redis, api]

  bot:
    image: ghcr.io/org/kopix-bot:${VERSION}
    restart: unless-stopped
    environment:
      BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      BOT_WEBHOOK_SECRET: ${BOT_WEBHOOK_SECRET}
      API_BASE_URL: http://api:3000
    depends_on: [api]

  miniapp:
    image: ghcr.io/org/kopix-miniapp:${VERSION}
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - certs:/etc/ssl/certs
    depends_on: [api, miniapp, bot]

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: kopix
      POSTGRES_USER: kopix
      POSTGRES_PASSWORD: ${DB_PASS}

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
  certs:
```

**Deploy new version**:
```bash
echo "VERSION=1.2.3" > .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
```

### 15.2 Option B: Kubernetes (Single Namespace)

For operators who prefer Kubernetes for reliability features (rolling updates, probes, resource management). Uses a single namespace — no multi-tenant complexity.

```
Namespace: kopix
│
├── Deployment: api-server    (2 replicas, HPA on CPU)
├── Deployment: trade-engine  (1 replica, no HPA — by design)
├── Deployment: telegram-bot  (1 replica)
├── Deployment: mini-app      (2 replicas, nginx)
├── StatefulSet: postgresql   (1 replica + PVC)
├── Deployment: redis         (1 replica + PVC)
├── Ingress                   (nginx-ingress, cert-manager annotation)
├── Certificate               (cert-manager, Let's Encrypt)
├── HPA: api-server           (CPU > 70%)
├── HPA: mini-app             (CPU > 70%)
└── PodDisruptionBudget       (minAvailable: 1 for api, miniapp)
```

### 15.3 Resource Requirements

| Service | CPU | Memory |
|---|---|---|
| api-server (per replica) | 250m | 256Mi |
| trade-engine | 500m | 512Mi |
| telegram-bot | 100m | 128Mi |
| mini-app nginx | 100m | 64Mi |
| postgresql | 1000m | 1Gi |
| redis | 200m | 512Mi |
| **Total** | **~2.5 cores** | **~2.5Gi** |

A 4 vCPU / 8GB RAM server provides comfortable headroom.

### 15.4 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    steps:
      - Build Docker images for all apps
      - Push to GitHub Container Registry (ghcr.io)
      - Tag with git SHA
      - SSH to production server
      - docker compose pull && docker compose up -d
      - Run: docker compose exec api npx prisma migrate deploy
      - Health check: curl /health/ready
```

---

## 16. Data Model (PostgreSQL)

```sql
-- Subscription plans (configured by operator via env or seed)
plans:
  id UUID PK
  name VARCHAR(100)
  price DECIMAL(10,2)
  currency VARCHAR(10)       -- 'USDT', 'TON', etc.
  duration_days INT
  is_active BOOLEAN
  created_at TIMESTAMPTZ

-- Subscribers (registered via Telegram /start)
subscribers:
  id UUID PK
  telegram_id BIGINT UNIQUE NOT NULL
  telegram_username VARCHAR(100)
  api_key_encrypted TEXT      -- AES-256-GCM encrypted BingX API key
  api_secret_encrypted TEXT   -- AES-256-GCM encrypted BingX secret
  copy_mode ENUM('fixed','percentage')
  fixed_amount DECIMAL(12,4)  -- USDT, used when mode=fixed
  percentage DECIMAL(5,2)     -- 0-100, used when mode=percentage
  max_position_usdt DECIMAL(12,4)  -- risk cap, nullable
  status ENUM('active','paused','inactive','suspended')
  created_at TIMESTAMPTZ
  updated_at TIMESTAMPTZ

-- Subscription periods
subscriptions:
  id UUID PK
  subscriber_id UUID FK → subscribers
  plan_id UUID FK → plans
  status ENUM('active','expired','cancelled')
  started_at TIMESTAMPTZ
  expires_at TIMESTAMPTZ
  cryptobot_invoice_id VARCHAR(100) UNIQUE  -- idempotency key
  amount_paid DECIMAL(10,2)
  currency VARCHAR(10)
  created_at TIMESTAMPTZ

-- Master account (single row, seeded/configured at deploy time)
master_account:
  id UUID PK
  exchange VARCHAR(20)         -- 'bingx'
  api_key_encrypted TEXT
  api_secret_encrypted TEXT
  is_active BOOLEAN
  connected_at TIMESTAMPTZ
  last_heartbeat TIMESTAMPTZ   -- updated every 30s by engine

-- Raw signals emitted when master trades
trade_signals:
  id UUID PK
  symbol VARCHAR(30)           -- e.g. 'BTC/USDT:USDT'
  side ENUM('buy','sell')
  signal_type ENUM('open','close','increase','decrease')
  master_price DECIMAL(20,8)
  master_size DECIMAL(20,8)
  master_position_id VARCHAR(100)
  raw_payload JSONB            -- full BingX event, for audit/replay
  created_at TIMESTAMPTZ

-- One row per subscriber per signal
copied_trades:
  id UUID PK
  signal_id UUID FK → trade_signals
  subscriber_id UUID FK → subscribers
  symbol VARCHAR(30)
  side ENUM('buy','sell')
  trade_type ENUM('open','close','increase','decrease')
  ordered_size DECIMAL(20,8)
  executed_size DECIMAL(20,8)
  executed_price DECIMAL(20,8)
  master_price DECIMAL(20,8)
  slippage_pct DECIMAL(10,6)
  exchange_order_id VARCHAR(100)
  status ENUM('pending','filled','partial','failed','skipped')
  failure_reason TEXT
  executed_at TIMESTAMPTZ
  created_at TIMESTAMPTZ

-- Open and closed positions, matched to opening signal
positions:
  id UUID PK
  subscriber_id UUID FK → subscribers
  open_signal_id UUID FK → trade_signals  -- used for close matching
  symbol VARCHAR(30)
  side ENUM('long','short')
  entry_price DECIMAL(20,8)
  exit_price DECIMAL(20,8)
  size DECIMAL(20,8)
  realized_pnl DECIMAL(20,8)
  status ENUM('open','closed')
  opened_at TIMESTAMPTZ
  closed_at TIMESTAMPTZ

-- Daily P&L snapshots (for fast dashboard rendering)
pnl_snapshots:
  id UUID PK
  subscriber_id UUID FK → subscribers
  date DATE
  realized_pnl DECIMAL(20,8)
  total_trades INT
  winning_trades INT
  created_at TIMESTAMPTZ
  UNIQUE(subscriber_id, date)
```

**Key indexes:**
- `subscribers(telegram_id)` — unique, primary lookup on every bot message
- `subscriptions(subscriber_id, status, expires_at)` — subscription validity check on every signal
- `copied_trades(subscriber_id, created_at DESC)` — trade history pagination
- `positions(subscriber_id, status)` — open position lookup on close signal
- `positions(open_signal_id, status)` — close matching by signal

---

## 17. Reliability and Failure Handling

### 17.1 Trade Engine Guarantees

The trade engine is a single-instance daemon. Parallelism would cause double-execution — this is intentional.

- **At-least-once delivery**: Redis Streams consumer groups redeliver unacknowledged messages after a timeout. On crash+restart, the engine resumes from the last unacknowledged entry.
- **Idempotency**: Before placing any order, the engine checks `copied_trades WHERE signal_id = ? AND subscriber_id = ? AND status NOT IN ('failed','skipped')`. Duplicates are no-ops.
- **Ordered processing**: One signal at a time, strictly ordered. Within a signal, subscriber orders are concurrent but the next signal waits for all to complete (or timeout).
- **Crash recovery**: Docker `restart: unless-stopped` or Kubernetes restarts the pod. On resume, it reads the stream from the pending-entries list.

### 17.2 Failure Scenarios

| Scenario | Detection | Response |
|---|---|---|
| BingX WebSocket disconnect (master) | Event or 30s heartbeat timeout | Reconnect with backoff (1s, 5s, 30s, 5min); fire alert after 60s |
| BingX API error on subscriber order | HTTP 4xx/5xx from ccxt | Retry 3× with backoff; mark failed; notify subscriber via bot |
| Subscriber insufficient balance | BingX error code | Skip immediately; notify subscriber; no retry |
| Subscriber API key revoked | 401/403 from BingX | Suspend subscriber; notify via bot |
| Engine process crash | Docker/K8s restarts | Auto-restart; resumes from Redis Stream pending list |
| PostgreSQL unavailable | Connection refused | Services return 503; engine pauses signal processing; alert |
| Redis unavailable | Connection refused | API/bot return 503; engine cannot process signals; alert |
| CryptoBot webhook not delivered | CryptoBot retries for 24h | Idempotent webhook handler (keyed on invoice_id) |
| SSL certificate expired | cert-manager monitors | Auto-renewed 30d before expiry; alert if renewal fails |

### 17.3 Database Resilience

- **Daily backup**: `pg_dump` via cron, encrypted and uploaded to S3-compatible storage.
- **WAL archiving**: Point-in-time recovery capability (configure `wal_level = replica`).
- **Connection pooling**: PgBouncer in transaction mode as sidecar. Prevents connection exhaustion from bot/API burst traffic.
- **Migrations**: Prisma Migrate runs as an init container (K8s) or `docker compose exec` step before any new version handles traffic. All migrations must be backward-compatible (additive only, no column drops in the same deploy).

### 17.4 Health Endpoints

```
GET /health/live    → 200 if process is alive (used by liveness probe)
GET /health/ready   → 200 if DB and Redis are reachable (used by readiness probe)
```

Engine exposes:
```
GET /health/engine  → 200 if WebSocket is connected, last signal < 5min ago (or no activity expected)
```

---

## 18. Logging and Monitoring

### 18.1 Log Format

All services use **Pino** for structured JSON logging:

```json
{
  "level": "info",
  "time": "2026-04-17T10:30:00.000Z",
  "service": "trade-engine",
  "subscriberId": "sub_abc123",
  "signalId": "sig_xyz456",
  "symbol": "BTC/USDT:USDT",
  "event": "order.placed",
  "orderId": "bingx_789",
  "executedSize": 1,
  "executedPrice": 68450.00,
  "slippagePct": 0.03
}
```

**Never log**: API keys, secrets, initData, or any value that was decrypted from the database.

### 18.2 Log Pipeline

```
Services → stdout → Promtail (sidecar or DaemonSet) → Loki → Grafana
```

For Docker Compose deployments without Loki: `docker compose logs -f --tail=100 engine` is sufficient for initial operations.

### 18.3 Key Metrics (Prometheus)

**Trade Engine:**
- `kopix_trade_signals_total{status}` — signals processed / failed
- `kopix_trade_execution_duration_seconds` — order placement latency histogram
- `kopix_active_subscribers` — subscribers with active subscriptions
- `kopix_master_watcher_last_event_seconds` — time since last master WebSocket event
- `kopix_slippage_pct{symbol}` — slippage distribution histogram

**API Server:**
- Standard Fastify metrics: `http_requests_total{route,status}`, `http_request_duration_seconds`

**Bot:**
- `kopix_bot_commands_total{command}` — command usage frequency

**Business:**
- `kopix_subscriptions_active` — current active subscriber count
- `kopix_payments_total{status}` — payment success/failure

### 18.4 Critical Alerts

```yaml
- alert: MasterWatcherDown
  expr: time() - kopix_master_watcher_last_event_seconds > 60
  severity: critical   # real money impact

- alert: TradeExecutionFailureSpike
  expr: rate(kopix_trade_signals_total{status="failed"}[5m]) > 0.05
  severity: critical

- alert: EngineDown
  expr: absent(kopix_master_watcher_last_event_seconds)
  for: 2m
  severity: critical

- alert: DatabaseConnectionFailed
  expr: kopix_health_ready == 0
  for: 30s
  severity: critical

- alert: HighSlippage
  expr: histogram_quantile(0.95, kopix_slippage_pct) > 0.5
  severity: warning
```

---

## 19. Security Model

### 19.1 API Key Encryption

Exchange API keys are the highest-risk data.

- **Algorithm**: AES-256-GCM. Authenticated encryption — detects tampering.
- **Key source**: `APP_ENCRYPTION_KEY` environment variable (32 random bytes, base64-encoded). Set once at deploy time, never in code or git.
- **Storage**: Encrypted ciphertext stored in PostgreSQL. Format: `base64(iv || ciphertext || authTag)`.
- **Decryption**: Only at the moment of order placement, in memory only. Never returned to API responses.
- **Message deletion**: Bot messages containing API keys are deleted via `deleteMessage` immediately after capture.

### 19.2 Network Security

- All external traffic over HTTPS only. HTTP redirects to HTTPS.
- PostgreSQL and Redis are internal-only (no exposed ports in Compose or K8s).
- Bot webhook validated via `X-Telegram-Bot-Api-Secret-Token` header (configured in `setWebhook`).
- CryptoBot webhooks validated via HMAC-SHA-256 (`X-Crypto-Pay-Api-Signature` header).
- Internal service communication over Docker network or Kubernetes ClusterIP — never exposed.

### 19.3 Authentication

| Surface | Method |
|---|---|
| Mini App ↔ API | Telegram initData HMAC-SHA-256 validation (5-minute expiry) |
| Bot webhook | Telegram secret token header |
| Payment webhook | CryptoBot HMAC-SHA-256 signature |
| Internal services | No auth (Docker/K8s network isolation) |

### 19.4 Least Privilege

- Subscriber BingX API keys: trade permission only. Withdraw permission absent — validated at `/connect` and rejected if present.
- Master BingX API key: read + trade permissions. Withdraw absent.
- PostgreSQL users: separate `kopix_api` (SELECT/INSERT/UPDATE) and `kopix_engine` (same) users — neither can DROP or ALTER.
- No admin HTTP endpoint exposed externally. Operator manages via SSH + `docker exec` or `kubectl exec`.

### 19.5 Input Validation

- All HTTP request bodies validated via Zod schemas. Invalid requests rejected at the route layer.
- Bot input treated as untrusted text. No dynamic query construction from bot input.
- Exchange API responses validated against expected schema before use. Unknown response shapes logged and discarded.
- SQL injection not possible: Prisma uses parameterized queries exclusively.

---

## 20. Scaling Strategy

### 20.1 Single Deployment Scaling

The current architecture scales vertically and within Docker/K8s:

| Component | Scaling | Rationale |
|---|---|---|
| `api-server` | Horizontal (HPA or Compose scale) | Stateless; scales well |
| `mini-app` | Horizontal (HPA) | Stateless static files |
| `trade-engine` | **Single instance only** | Parallelism = duplicate orders |
| `telegram-bot` | Single instance | Webhook-based; no concurrency needed |
| `postgresql` | Vertical + connection pool | Add read replica for analytics later |
| `redis` | Vertical | No cluster needed for single deployment |

**Trade engine throughput**: At 20 concurrent order placements, each taking ~300ms average (BingX API latency), a single signal with 400 subscribers completes in ~6 seconds. For 100 subscribers it's under 2 seconds. This is acceptable for copy trading — master trades are infrequent (not HFT).

### 20.2 Load Capacity (Estimated)

| Metric | Capacity (single server, 4 vCPU) |
|---|---|
| Concurrent Mini App users | 500+ (nginx static serving) |
| Simultaneous SSE connections | 200+ |
| Active subscribers (per signal) | 500 |
| Signals per hour | 60–120 (typical manual trading) |
| PostgreSQL connections (via PgBouncer) | 200 |

### 20.3 Latency Targets

| Step | Target |
|---|---|
| BingX WebSocket event → Redis Stream | < 50ms |
| Redis Stream → Engine consumer start | < 20ms |
| Size calculation (PERCENTAGE mode) | < 200ms (includes balance fetch) |
| BingX order placement | 100–500ms |
| Total: signal → first order placed | < 800ms |

---

## 21. Risks and Tradeoffs

### 21.1 BingX API Stability
**Risk**: BingX is a mid-tier exchange; API reliability may be lower than Binance/Bybit.
**Mitigation**: Robust reconnect logic with exponential backoff; circuit breaker on HTTP calls; immediate alerting on disconnect. The exchange abstraction (`packages/exchange`) makes adding a second exchange a future option without rewrites.

### 21.2 Single Trade Engine Instance
**Tradeoff**: No horizontal scaling; vertical limits apply.
**Why accepted**: Correctness is non-negotiable. A duplicate trade entry is a real financial harm to subscribers. A single well-resourced instance handles hundreds of subscribers comfortably. At true scale (thousands of subscribers), shard by subscriber range across multiple instances using Redis Stream partitioning — but this is a future problem.

### 21.3 Exchange API Keys in Storage
**Risk**: Storing subscriber API keys is the highest-value security target.
**Mitigation**: AES-256-GCM encryption, key in environment variable (not DB), keys validated to prohibit withdrawals, bot messages deleted, no key ever returned in API responses, access logged.

### 21.4 Slippage
**Risk**: Subscriber orders fill at worse prices than the master.
**Mitigation**: Inherent to copy trading. Use market orders to guarantee fills. Track and display slippage to subscribers. Document this behavior explicitly. Do not hide it.

### 21.5 CryptoBot Dependency
**Risk**: CryptoBot is a Telegram-ecosystem service.
**Why accepted**: Native payment UI inside Telegram, zero friction for users, simple API, operated by the TON Foundation (same team as Telegram). An alternative (Telegram Stars, on-chain payments) is significantly more complex. The dependency risk is low.

### 21.6 Docker Compose in Production
**Tradeoff**: Less resilient than Kubernetes for single-service failures.
**Why accepted**: At the current scale, Docker Compose with `restart: unless-stopped` and a process monitor (systemd for Docker daemon) is operationally simple and reliable. The Kubernetes path is available for operators who need it. Complexity is earned, not assumed.

---

## 22. Current Product Scope

This is what is being built now. It is the complete, production-ready product.

**Included:**

- BingX Perpetual Futures integration (REST + WebSocket)
- Master account watcher (WebSocket-based, resilient reconnect)
- Copy trading engine with two modes: fixed USDT, percentage of balance
- Trade signal queue (Redis Streams, consumer groups, idempotent processing)
- Position tracking and P&L calculation
- Telegram bot: `/start`, `/connect`, `/subscribe`, `/status`, `/mode`, `/pause`, `/resume`, `/dashboard`
- Telegram Mini App: dashboard, connect exchange, subscribe, trade history, settings
- CryptoBot payment integration (invoice creation, webhook confirmation)
- Subscription lifecycle (activation, expiry, notifications)
- API key encryption (AES-256-GCM)
- Domain-based deployment with automatic SSL
- Docker Compose production deployment
- Kubernetes single-namespace deployment (alternative)
- Prometheus + Grafana monitoring
- Structured JSON logging (Pino)
- Alertmanager alerts (critical failures)
- GitHub Actions CI/CD

**Not in scope for this phase:**

- Multi-client deployments
- Automated provisioning of new instances
- Central control plane or fleet management
- Multiple exchange support (architecture is exchange-agnostic, but only BingX is implemented)
- Client-facing admin panel (operator manages via env vars and direct DB/logs access)
- Custom branding per deployment
- Referral system
- Advanced analytics (Sharpe ratio, drawdown)
- ArgoCD GitOps
- Horizontal autoscaling of trade engine

---

## 23. Future: White-Label Platform

When the product is proven and reliable, it becomes a white-label platform. This section defines what that means and what it requires. None of this is built in Phase 1.

### 23.1 Vision

Multiple business clients each license KopiX. Each client gets an isolated deployment — their own Telegram bot, their own domain, their own master trader, their own subscribers, their own database. One codebase, many deployments.

### 23.2 What it requires

- **Helm chart for the application**: The current `docker-compose.prod.yml` is parameterized into a Helm chart. Each client deployment becomes a `helm install kopix-{slug}` with per-client values.
- **Kubernetes namespace per client**: Network isolation, resource quotas, independent lifecycle.
- **Control plane**: A separate internal service that manages client records, triggers Helm installs, monitors deployment health, and handles billing.
- **Automated provisioning flow**: Operator fills a form → system creates namespace, installs Helm chart, registers webhook, confirms health.
- **Per-client encryption keys**: Currently one `APP_ENCRYPTION_KEY` per deployment. In multi-client mode, each client gets its own key, managed via K8s Secrets or a KMS.
- **ArgoCD**: Declarative management of many Application objects, auto-sync from git.
- **Central monitoring aggregation**: Loki label-based multi-tenant log routing. Per-client Grafana dashboards.

### 23.3 Architecture continuity

The Phase 1 codebase is written to support this future:
- All exchange code is behind an adapter interface (`packages/exchange`) — adding BingX support for a second client is a config change.
- The Prisma schema uses per-deployment databases — no multi-tenant row filtering to add later.
- Docker Compose is already parameterized via environment variables — converting to a Helm chart `values.yaml` is mechanical.
- Services are independently deployable (separate Docker images) — placing them in separate K8s pods is already the pattern.

---

## 24. Open Questions and Assumptions

### Assumptions Made
1. **Exchange**: BingX Perpetual Futures only. All subscribers and the master use BingX.
2. **Position mode**: BingX Hedge Mode (separate LONG/SHORT positions). Validate at API key connection.
3. **Subscriber count**: Initial target is 10–200 subscribers. Architecture handles 500+ without changes.
4. **Master awareness**: The master trader knows their account is being copied.
5. **API key model**: Subscribers provide their own BingX API keys. KopiX never holds or controls funds.
6. **Leverage and margin**: Not managed by KopiX. Subscribers configure their own. This is documented to subscribers as their responsibility.
7. **Subscription model**: Fixed duration (e.g., 30 days), payment in USDT via CryptoBot. No free tier.
8. **Subscription expiry**: When expired, copying stops. Open positions are left open until the master closes them — not force-closed.

### Open Questions
1. **Position mode**: Should the system support both hedge mode and one-way mode, or require hedge mode? One-way mode means separate tracking of net direction per symbol — more complex.
2. **Multiple plans**: Should the operator be able to configure multiple subscription plans (e.g., 7-day trial, 30-day, 90-day)?
3. **Subscriber leverage control**: Should KopiX allow subscribers to set leverage through the mini app, or leave it fully to their BingX account settings?
4. **Master visibility**: Should the master trader be able to see an anonymized count of how many subscribers copied their last trade?
5. **Partial close ratio**: When the master partially closes (e.g., 50% of position), should subscribers close exactly 50% or the same fixed amount?

---

## 25. Implementation Priorities

Build in this order. Every phase ends with a working, testable product increment.

### Phase 1 — Foundation (Week 1–2)
1. Initialize monorepo (npm workspaces + Turborepo)
2. TypeScript, ESLint, Prettier across all packages and apps
3. `packages/shared`: enums (SignalType, CopyMode, SubscriberStatus), shared DTOs
4. `packages/db`: Prisma schema with all tables; migrations; seed for dev (plans, master account)
5. `packages/crypto`: AES-256-GCM encrypt/decrypt with IV + auth tag
6. Docker Compose for local development (postgres:16, redis:7)
7. `packages/exchange`: ccxt BingX adapter — validateCredentials, getBalance, placeMarketOrder

### Phase 2 — Trade Engine Core (Week 2–3)
8. Master Account Watcher: BingX listenKey flow, WebSocket connection, heartbeat/reconnect
9. Signal normalizer: map BingX `ORDER_TRADE_UPDATE` events to `TradeSignal` shape
10. Redis Stream publisher: write signals to `trade-signals` stream
11. Signal consumer: Redis Streams consumer group, idempotency check
12. `calculateOrderSize()`: fixed and percentage modes, minimum order check, balance fetch
13. Subscriber executor: `placeMarketOrder()` via ccxt, record in `copied_trades`
14. Position tracker: open/close position records, P&L on close
15. Concurrency control: semaphore (20 parallel), error handling per subscriber

### Phase 3 — API Server (Week 3–4)
16. `apps/api`: Fastify + Zod, health endpoints, Pino logging
17. Auth middleware: Telegram initData HMAC-SHA-256 validation
18. `POST /api/exchange/validate` — validate and store encrypted BingX credentials
19. `GET /api/subscribers/me` — profile, subscription status, copy config
20. `PATCH /api/subscribers/me` — update copy mode, fixed amount, percentage, max position
21. `GET /api/trades` — paginated trade history with P&L
22. `GET /api/positions` — open positions
23. `GET /api/stats` — aggregate P&L, win rate, total trades
24. `GET /api/stream/trades` — SSE endpoint (Redis pub/sub → HTTP stream)
25. Rate limiting: Redis-backed, per-subscriber

### Phase 4 — Telegram Bot (Week 4–5)
26. `apps/bot`: grammY skeleton, webhook mode, secret token validation
27. `/start` → register subscriber, welcome message
28. `/connect` → API key collection (force_reply), delete messages, call validate API
29. `/subscribe` → show plans from DB, trigger invoice creation
30. `/status` → subscription expiry, copy mode, active state
31. `/mode` → inline keyboard for fixed/percentage, follow-up for amount/percent input
32. `/pause`, `/resume` → toggle subscriber status
33. `/dashboard` → send Mini App URL inline button
34. Subscription expiry notifications: 24h, 1h, on-expiry (cron-driven)

### Phase 5 — Payment (Week 5)
35. CryptoBot API client: `createInvoice()`, webhook HMAC validation
36. `POST /api/subscriptions/create-invoice` — create CryptoBot invoice, return URL
37. `POST /api/webhooks/cryptobot` — verify signature, idempotency check, activate subscription
38. Subscription expiry cron job (every 15 minutes)
39. Bot message on payment confirmed

### Phase 6 — Mini App (Week 6–7)
40. `apps/miniapp`: React + Vite + Tailwind, Telegram Web App SDK init
41. Auth hook: extract initData, attach to all API calls
42. API client (typed, using shared DTOs)
43. Dashboard page: P&L chart, subscription status, copy mode pill, recent trades list
44. Connect Exchange page: API key + secret form, validation feedback
45. Subscribe page: plan cards, CryptoBot payment trigger via `Telegram.WebApp.openInvoice()`
46. Trade History page: paginated, slippage shown per trade
47. Settings page: copy mode toggle, amount/percentage inputs, max position, pause/resume
48. Payment Success page
49. SSE integration: live trade feed updates dashboard without reload

### Phase 7 — Production Deployment (Week 8–9)
50. Dockerfiles for all apps (multi-stage, minimal images)
51. `docker-compose.prod.yml`: all services, healthchecks, restart policies
52. nginx config: HTTPS, /api proxy, /api/stream SSE config, static miniapp
53. cert-manager or Caddy for automatic SSL
54. GitHub Actions: build images, push to ghcr.io, SSH deploy, migrate, health check
55. Prometheus instrumentation in engine and API (key metrics from §18.3)
56. Grafana dashboard setup (trade activity, engine health, subscriber count)
57. Alertmanager: MasterWatcherDown, TradeExecutionFailureSpike, EngineDown rules
58. Daily PostgreSQL backup to S3 (cron + `pg_dump` + `aws s3 cp`)
59. PgBouncer connection pooler sidecar

### Phase 8 — Hardening and Validation (Week 9–10)
60. End-to-end test: register subscriber → connect BingX testnet → pay → master trade → copy executed → P&L visible
61. Security review: API key storage path, webhook signature validation, initData replay attack test
62. Load test: simulate 100 concurrent subscribers, measure signal→first-order latency
63. Failure injection: kill engine mid-signal → verify idempotent replay; kill postgres → verify 503 + recovery
64. Runbook: deploy update, rollback, backup restore, bot webhook re-register, engine restart

### Phase 9 — White-Label Platform (Future, Post-Launch)
65. Parameterize configuration (Helm chart from Compose)
66. Kubernetes namespace isolation + NetworkPolicies per client
67. Per-client encryption key management
68. Control plane API (provisioning service)
69. Admin dashboard (list clients, create, update, health)
70. ArgoCD Application-per-client GitOps
71. Multi-client monitoring aggregation (Loki labels, per-client Grafana dashboards)
72. Automated webhook registration on provision
73. Client onboarding flow
