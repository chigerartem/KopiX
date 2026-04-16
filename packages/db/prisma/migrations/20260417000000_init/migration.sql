-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('active', 'paused', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "CopyMode" AS ENUM ('fixed', 'percentage');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "SignalSide" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('open', 'close', 'increase', 'decrease');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('pending', 'filled', 'partial', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('long', 'short');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "telegramUsername" VARCHAR(100),
    "apiKeyEncrypted" TEXT,
    "apiSecretEncrypted" TEXT,
    "copyMode" "CopyMode",
    "fixedAmount" DECIMAL(12,4),
    "percentage" DECIMAL(5,2),
    "maxPositionUsdt" DECIMAL(12,4),
    "status" "SubscriberStatus" NOT NULL DEFAULT 'inactive',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "cryptobotInvoiceId" VARCHAR(100),
    "amountPaid" DECIMAL(10,2),
    "currency" VARCHAR(10),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_accounts" (
    "id" TEXT NOT NULL,
    "exchange" VARCHAR(20) NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "apiSecretEncrypted" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectedAt" TIMESTAMPTZ(6) NOT NULL,
    "lastHeartbeat" TIMESTAMPTZ(6),

    CONSTRAINT "master_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_signals" (
    "id" TEXT NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "side" "SignalSide" NOT NULL,
    "signalType" "SignalType" NOT NULL,
    "masterPrice" DECIMAL(20,8) NOT NULL,
    "masterSize" DECIMAL(20,8) NOT NULL,
    "masterPositionId" VARCHAR(100) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copied_trades" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "side" "SignalSide" NOT NULL,
    "tradeType" "SignalType" NOT NULL,
    "orderedSize" DECIMAL(20,8) NOT NULL,
    "executedSize" DECIMAL(20,8),
    "executedPrice" DECIMAL(20,8),
    "masterPrice" DECIMAL(20,8) NOT NULL,
    "slippagePct" DECIMAL(10,6),
    "exchangeOrderId" VARCHAR(100),
    "status" "TradeStatus" NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "executedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copied_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "openSignalId" TEXT NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "side" "PositionSide" NOT NULL,
    "entryPrice" DECIMAL(20,8) NOT NULL,
    "exitPrice" DECIMAL(20,8),
    "size" DECIMAL(20,8) NOT NULL,
    "realizedPnl" DECIMAL(20,8),
    "status" "PositionStatus" NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMPTZ(6) NOT NULL,
    "closedAt" TIMESTAMPTZ(6),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnl_snapshots" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "realizedPnl" DECIMAL(20,8) NOT NULL,
    "totalTrades" INTEGER NOT NULL,
    "winningTrades" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pnl_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_telegramId_key" ON "subscribers"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_cryptobotInvoiceId_key" ON "subscriptions"("cryptobotInvoiceId");

-- CreateIndex
CREATE INDEX "subscriptions_subscriberId_status_expiresAt_idx" ON "subscriptions"("subscriberId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "copied_trades_signalId_subscriberId_key" ON "copied_trades"("signalId", "subscriberId");

-- CreateIndex
CREATE INDEX "copied_trades_subscriberId_createdAt_idx" ON "copied_trades"("subscriberId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "positions_subscriberId_status_idx" ON "positions"("subscriberId", "status");

-- CreateIndex
CREATE INDEX "positions_openSignalId_status_idx" ON "positions"("openSignalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pnl_snapshots_subscriberId_date_key" ON "pnl_snapshots"("subscriberId", "date");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copied_trades" ADD CONSTRAINT "copied_trades_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "trade_signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copied_trades" ADD CONSTRAINT "copied_trades_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_openSignalId_fkey" FOREIGN KEY ("openSignalId") REFERENCES "trade_signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pnl_snapshots" ADD CONSTRAINT "pnl_snapshots_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
