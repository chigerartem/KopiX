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
import { Semaphore } from "./semaphore.js";
import { logger } from "../logger.js";
import { signalsProcessedTotal, tradesExecutedTotal } from "../metrics.js";

// How many subscriber executions run in parallel inside one signal.
// Tuned for ~5000 subscribers per master trade. The BingX rate limiter
// (subscriberExecutor → exchange package) still gates real outbound calls,
// so this is mostly the in-process queue depth, not BingX concurrency.
const CONCURRENCY = Number(process.env["ENGINE_CONCURRENCY"] ?? 100);
// Batch size for memory bounds + bulk DB queries (status counts) per chunk.
const BATCH_SIZE = Number(process.env["ENGINE_BATCH_SIZE"] ?? 500);

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
      signaledAt: new Date(signal.timestamp),
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

  let totalFailed = 0;
  const startedAt = Date.now();

  // Process subscribers in batches: bounds peak memory & log volume, and
  // lets us emit progress events for ops visibility on big fanouts.
  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((subscriber: Subscriber) =>
        semaphore.run(async () => {
          try {
            // Trade execution + position write happen atomically inside
            // executeForSubscriber (single Prisma transaction).
            await executeForSubscriber(signal, subscriber);
          } catch (err: unknown) {
            logger.error(
              { event: "processor.subscriber_error", subscriberId: subscriber.id, err },
              "Unhandled error for subscriber",
            );
            throw err;
          }
        }),
      ),
    );

    totalFailed += results.filter((r) => r.status === "rejected").length;

    // Bulk-count outcomes by status for this batch — one DB roundtrip
    // instead of N findUnique calls.
    const counts = await prisma.copiedTrade.groupBy({
      by: ["status"],
      where: {
        signalId: signal.id,
        subscriberId: { in: batch.map((s) => s.id) },
      },
      _count: { _all: true },
    });
    for (const c of counts) {
      tradesExecutedTotal.inc({ status: c.status }, c._count._all);
    }

    if (subscribers.length > BATCH_SIZE) {
      log.info(
        {
          event: "processor.batch_done",
          processed: Math.min(i + BATCH_SIZE, subscribers.length),
          total: subscribers.length,
        },
        "Subscriber batch processed",
      );
    }
  }

  signalsProcessedTotal.inc({ status: totalFailed === 0 ? "success" : "partial_failure" });
  log.info(
    {
      event: "processor.complete",
      total: subscribers.length,
      failed: totalFailed,
      elapsedMs: Date.now() - startedAt,
    },
    "Signal processing complete",
  );
}

function resolveDbSignalType(st: SignalType): "open" | "close" | "increase" | "decrease" {
  if (st === SignalType.OpenLong || st === SignalType.OpenShort) return "open";
  if (st === SignalType.CloseLong || st === SignalType.CloseShort) return "close";
  if (st === SignalType.IncreaseLong || st === SignalType.IncreaseShort) return "increase";
  return "decrease";
}
