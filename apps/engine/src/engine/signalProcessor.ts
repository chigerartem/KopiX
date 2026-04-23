/**
 * Signal processor — wires together:
 *   consumer → [per subscriber in parallel, max 20] → executor → position tracker
 *
 * Processes one signal at a time (ordered).
 * Within a signal, subscriber orders run concurrently under the semaphore.
 */

import type { TradeSignal } from "@kopix/shared";
import { SignalType } from "@kopix/shared";
import { createPrismaClient, Prisma, type Subscriber } from "@kopix/db";
import { executeForSubscriber } from "./subscriberExecutor.js";
import { openPosition, closePosition } from "./positionTracker.js";
import { Semaphore } from "./semaphore.js";
import { logger } from "../logger.js";
import { signalsProcessedTotal, tradesExecutedTotal } from "../metrics.js";

const CONCURRENCY = 20;
const prisma = createPrismaClient();

/**
 * Process one signal across all active subscribers.
 * Called by the signal consumer for each stream entry.
 */
export async function processSignal(signal: TradeSignal): Promise<void> {
  const log = logger.child({ signalId: signal.id, symbol: signal.symbol });
  log.info({ event: "processor.start", signalType: signal.signalType }, "Processing signal");

  // Persist signal record first
  await prisma.tradeSignal.upsert({
    where: { id: signal.id },
    update: {},
    create: {
      id: signal.id,
      symbol: signal.symbol,
      side: signal.side === "buy" ? "buy" : "sell",
      signalType: resolveDbSignalType(signal.signalType),
      masterPrice: signal.masterPrice,
      masterSize: signal.masterSize,
      masterPositionId: signal.masterPositionId,
      rawPayload: signal as unknown as Prisma.InputJsonValue,
    },
  });

  // Load active subscribers with valid credentials
  const subscribers = await prisma.subscriber.findMany({
    where: {
      status: "active",
      apiKeyEncrypted: { not: null },
      apiSecretEncrypted: { not: null },
      subscriptions: {
        some: {
          status: "active",
          expiresAt: { gt: new Date() },
        },
      },
    },
  });

  if (subscribers.length === 0) {
    log.info({ event: "processor.no_subscribers" }, "No active subscribers — signal skipped");
    return;
  }

  log.info({ event: "processor.subscribers_found", count: subscribers.length });

  // Fresh semaphore per signal — prevents the pool from leaking slots between
  // signals if a prior processing call was cancelled mid-flight, and keeps
  // resource usage bounded even if the consumer becomes concurrent later.
  const semaphore = new Semaphore(CONCURRENCY);

  // Run all subscribers concurrently (max CONCURRENCY at a time)
  const results = await Promise.allSettled(
    subscribers.map((subscriber: Subscriber) =>
      semaphore.run(async () => {
        try {
          await executeForSubscriber(signal, subscriber);

          // Update position tracking after execution
          const trade = await prisma.copiedTrade.findUnique({
            where: {
              signalId_subscriberId: { signalId: signal.id, subscriberId: subscriber.id },
            },
          });

          tradesExecutedTotal.inc({ status: trade?.status ?? "unknown" });

          if (trade?.status === "filled" && trade.executedPrice && trade.executedSize) {
            const price = Number(trade.executedPrice);
            const size = Number(trade.executedSize);

            if (
              signal.signalType === SignalType.OpenLong ||
              signal.signalType === SignalType.OpenShort
            ) {
              await openPosition(signal, subscriber.id, price, size);
            } else if (
              signal.signalType === SignalType.CloseLong ||
              signal.signalType === SignalType.CloseShort
            ) {
              await closePosition(signal, subscriber.id, price);
            }
          }
        } catch (err: unknown) {
          logger.error(
            { event: "processor.subscriber_error", subscriberId: subscriber.id, err },
            "Unhandled error for subscriber",
          );
        }
      }),
    ),
  );

  const failed = results.filter((r: PromiseSettledResult<void>) => r.status === "rejected").length;
  signalsProcessedTotal.inc({ status: failed === 0 ? "success" : "partial_failure" });
  log.info(
    { event: "processor.complete", total: subscribers.length, failed },
    "Signal processing complete",
  );
}

function resolveDbSignalType(st: SignalType): "open" | "close" | "increase" | "decrease" {
  if (st === SignalType.OpenLong || st === SignalType.OpenShort) return "open";
  if (st === SignalType.CloseLong || st === SignalType.CloseShort) return "close";
  if (st === SignalType.IncreaseLong || st === SignalType.IncreaseShort) return "increase";
  return "decrease";
}
