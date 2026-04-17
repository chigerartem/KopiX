/**
 * Subscriber executor.
 *
 * For a given TradeSignal and one subscriber:
 *   1. Idempotency check — skip if copied_trade row already exists (non-failed)
 *   2. Decrypt subscriber API credentials
 *   3. Calculate order size (calculateOrderSize)
 *   4. Place market order via @kopix/exchange
 *   5. Record result in copied_trades table
 *   6. Retry up to 3× with exponential backoff on transient errors
 *
 * Failure categories (from architecture §10.5):
 *   - Insufficient balance → skip, no retry
 *   - Invalid API key (401/403) → suspend subscriber, no retry
 *   - Other exchange error → retry 3×; on exhaustion → mark failed
 */

import type { TradeSignal } from "@kopix/shared";
import { SignalType, OrderSide } from "@kopix/shared";
import { placeMarketOrder } from "@kopix/exchange";
import { decrypt } from "@kopix/crypto";
import { createPrismaClient } from "@kopix/db";
import { calculateOrderSize } from "./calculateOrderSize.js";
import { getRedisClient } from "../redis/redisClient.js";
import { logger } from "../logger.js";
import type { Subscriber } from "@kopix/db";
import type { CopyMode } from "@kopix/shared";
import { CopyMode as CopyModeEnum } from "@kopix/shared";

const MAX_RETRIES = 3;
const BACKOFF_MS = [200, 1_000, 4_000];

const prisma = createPrismaClient();

function signalTypeToTradeType(st: SignalType): "open" | "close" | "increase" | "decrease" {
  if (st === SignalType.OpenLong || st === SignalType.OpenShort) return "open";
  if (st === SignalType.CloseLong || st === SignalType.CloseShort) return "close";
  if (st === SignalType.IncreaseLong || st === SignalType.IncreaseShort) return "increase";
  return "decrease";
}

function resolvePositionSide(signalType: SignalType): "LONG" | "SHORT" {
  return signalType === SignalType.OpenLong ||
    signalType === SignalType.CloseLong ||
    signalType === SignalType.IncreaseLong ||
    signalType === SignalType.DecreaseLong
    ? "LONG"
    : "SHORT";
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function executeForSubscriber(
  signal: TradeSignal,
  subscriber: Subscriber,
): Promise<void> {
  const log = logger.child({ signalId: signal.id, subscriberId: subscriber.id });

  // 1. Idempotency check
  // Skip only trades that already reached a terminal state on the exchange:
  //   - filled (exchangeOrderId present)
  //   - skipped (business decision, e.g. no credentials / below min size)
  // Pending trades without exchangeOrderId are left alone and retried below,
  // because a crash between DB upsert and exchange call must not lose the trade.
  const existing = await prisma.copiedTrade.findUnique({
    where: { signalId_subscriberId: { signalId: signal.id, subscriberId: subscriber.id } },
  });
  if (existing) {
    if (existing.status === "filled" && existing.exchangeOrderId) {
      log.debug({ event: "executor.idempotent_skip" }, "Trade already filled — skipping");
      return;
    }
    if (existing.status === "skipped") {
      log.debug({ event: "executor.already_skipped" }, "Trade was skipped — not retrying");
      return;
    }
    // pending / failed → fall through and (re)try
  }

  // 2. Decrypt credentials
  const encKey = process.env["APP_ENCRYPTION_KEY"];
  if (!encKey) throw new Error("APP_ENCRYPTION_KEY not set");
  if (!subscriber.apiKeyEncrypted || !subscriber.apiSecretEncrypted) {
    log.warn({ event: "executor.no_credentials" }, "Subscriber has no API credentials — skipping");
    await recordSkipped(signal, subscriber.id, "no_credentials");
    return;
  }
  const credentials = {
    apiKey: decrypt(subscriber.apiKeyEncrypted, encKey),
    apiSecret: decrypt(subscriber.apiSecretEncrypted, encKey),
  };

  // 3. Calculate order size
  const sizeResult = await calculateOrderSize(
    {
      subscriberId: subscriber.id,
      copyMode: subscriber.copyMode as CopyMode ?? CopyModeEnum.Fixed,
      fixedAmount: subscriber.fixedAmount ? Number(subscriber.fixedAmount) : null,
      percentage: subscriber.percentage ? Number(subscriber.percentage) : null,
      maxPositionUsdt: subscriber.maxPositionUsdt ? Number(subscriber.maxPositionUsdt) : null,
    },
    credentials,
  );

  if (sizeResult.skip) {
    log.info({ event: "executor.size_skip", reason: sizeResult.reason }, "Order size skip");
    await recordSkipped(signal, subscriber.id, sizeResult.reason);
    return;
  }

  // Create pending record before attempting
  const tradeRecord = await prisma.copiedTrade.upsert({
    where: { signalId_subscriberId: { signalId: signal.id, subscriberId: subscriber.id } },
    update: { status: "pending" },
    create: {
      signalId: signal.id,
      subscriberId: subscriber.id,
      symbol: signal.symbol,
      side: signal.side === OrderSide.Buy ? "buy" : "sell",
      tradeType: signalTypeToTradeType(signal.signalType),
      orderedSize: sizeResult.contractSize,
      masterPrice: signal.masterPrice,
      status: "pending",
    },
  });

  // 4. Place order with retries
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await placeMarketOrder(credentials, {
        symbol: signal.symbol,
        side: signal.side === OrderSide.Buy ? "buy" : "sell",
        amount: sizeResult.contractSize,
        positionSide: resolvePositionSide(signal.signalType),
      });

      const slippagePct =
        signal.masterPrice > 0
          ? Math.abs(result.executedPrice - signal.masterPrice) / signal.masterPrice
          : null;

      // 5. Record result
      await prisma.copiedTrade.update({
        where: { id: tradeRecord.id },
        data: {
          executedSize: result.executedAmount,
          executedPrice: result.executedPrice,
          slippagePct: slippagePct ?? null,
          exchangeOrderId: result.orderId,
          status: "filled",
          executedAt: new Date(),
        },
      });

      log.info(
        {
          event: "executor.filled",
          orderId: result.orderId,
          executedPrice: result.executedPrice,
          slippagePct,
        },
        "Order filled",
      );

      // Publish to the subscriber's SSE channel so the Mini App gets a live update.
      // Architecture §14.3 — channel "trades:{subscriberId}".
      try {
        const redis = getRedisClient();
        await redis.publish(
          `trades:${subscriber.id}`,
          JSON.stringify({
            type: "trade_executed",
            data: {
              id: tradeRecord.id,
              signalId: signal.id,
              symbol: signal.symbol,
              side: signal.side,
              tradeType: signalTypeToTradeType(signal.signalType),
              executedSize: result.executedAmount,
              executedPrice: result.executedPrice,
              masterPrice: signal.masterPrice,
              slippagePct,
              orderId: result.orderId,
              executedAt: new Date().toISOString(),
            },
          }),
        );
      } catch (pubErr: unknown) {
        log.warn({ event: "executor.publish_failed", err: pubErr }, "Failed to publish trade event");
      }

      return;
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Insufficient balance — no retry
      if (msg.includes("insufficient") || msg.includes("InsufficientFunds")) {
        await prisma.copiedTrade.update({
          where: { id: tradeRecord.id },
          data: { status: "skipped", failureReason: "insufficient_balance" },
        });
        log.info({ event: "executor.insufficient_balance" }, "Insufficient balance — skipped");
        return;
      }

      // Invalid key — suspend subscriber, no retry
      if (msg.includes("AuthenticationError") || msg.includes("PermissionDenied") || msg.includes("401") || msg.includes("403")) {
        await prisma.subscriber.update({
          where: { id: subscriber.id },
          data: { status: "suspended" },
        });
        await prisma.copiedTrade.update({
          where: { id: tradeRecord.id },
          data: { status: "failed", failureReason: "invalid_api_key" },
        });
        log.warn({ event: "executor.suspended", err }, "Subscriber suspended — invalid API key");
        return;
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_MS[attempt] ?? 4_000;
        log.warn({ event: "executor.retry", attempt, delay, err }, `Order failed — retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  await prisma.copiedTrade.update({
    where: { id: tradeRecord.id },
    data: {
      status: "failed",
      failureReason: lastError instanceof Error ? lastError.message : String(lastError),
    },
  });
  log.error({ event: "executor.failed", err: lastError }, "Order failed after all retries");
}

async function recordSkipped(
  signal: TradeSignal,
  subscriberId: string,
  reason: string,
): Promise<void> {
  await prisma.copiedTrade.upsert({
    where: { signalId_subscriberId: { signalId: signal.id, subscriberId } },
    update: { status: "skipped", failureReason: reason },
    create: {
      signalId: signal.id,
      subscriberId,
      symbol: signal.symbol,
      side: signal.side === OrderSide.Buy ? "buy" : "sell",
      tradeType: signalTypeToTradeType(signal.signalType),
      orderedSize: 0,
      masterPrice: signal.masterPrice,
      status: "skipped",
      failureReason: reason,
    },
  });
}
