/**
 * Signal consumer.
 *
 * Uses Redis Streams consumer groups for at-least-once delivery:
 *   - XGROUP CREATE trade-signals engine-group $ MKSTREAM
 *   - XREADGROUP GROUP engine-group engine-consumer COUNT 1 BLOCK 5000 STREAMS trade-signals >
 *   - XACK after successful processing
 *
 * On startup, first drains pending entries (PEL) from a previous crash,
 * then switches to live consumption with ">".
 *
 * Idempotency: before processing a signal, check copied_trades for
 * existing (signal_id, subscriber_id) entries.
 */

import { TRADE_SIGNALS_STREAM, deserialiseStreamEntry } from "../redis/streamPublisher.js";
import { getRedisClient } from "../redis/redisClient.js";
import { logger } from "../logger.js";
import type { TradeSignal } from "@kopix/shared";

const CONSUMER_GROUP = "engine-group";
const CONSUMER_NAME = "engine-consumer";
const BLOCK_MS = 5_000;
const COUNT = 10;

export type SignalProcessor = (signal: TradeSignal, streamEntryId: string) => Promise<void>;

async function ensureConsumerGroup(): Promise<void> {
  const redis = getRedisClient();
  try {
    await redis.xgroup("CREATE", TRADE_SIGNALS_STREAM, CONSUMER_GROUP, "$", "MKSTREAM");
    logger.info({ event: "consumer.group_created" }, "Consumer group created");
  } catch (err: unknown) {
    // BUSYGROUP = group already exists; safe to ignore
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("BUSYGROUP")) throw err;
    logger.debug({ event: "consumer.group_exists" }, "Consumer group already exists");
  }
}

type XAutoClaimReply = [string, Array<[string, string[]]>, string[]];

async function drainPending(processor: SignalProcessor): Promise<void> {
  const redis = getRedisClient();

  // Use XAUTOCLAIM to reclaim idle pending entries (idle > 0ms = all)
  let cursor = "0-0";
  let claimed = 0;

  while (true) {
    const reply = (await redis.xautoclaim(
      TRADE_SIGNALS_STREAM,
      CONSUMER_GROUP,
      CONSUMER_NAME,
      0,
      cursor,
      "COUNT",
      COUNT,
    )) as XAutoClaimReply;

    const nextCursor = reply[0];
    const entries = reply[1];

    for (const [entryId, fields] of entries) {
      if (!fields?.length) continue;
      try {
        const signal = deserialiseStreamEntry(fields);
        signal.streamId = entryId;
        await processor(signal, entryId);
        await redis.xack(TRADE_SIGNALS_STREAM, CONSUMER_GROUP, entryId);
        claimed++;
      } catch (err: unknown) {
        logger.error({ event: "consumer.pending_entry_failed", entryId, err });
      }
    }

    if (nextCursor === "0-0" || entries.length === 0) break;
    cursor = nextCursor;
  }

  if (claimed > 0) {
    logger.info({ event: "consumer.pending_drained", claimed }, `Processed ${claimed} pending entries`);
  }
}

/**
 * Start the signal consumer loop.
 * Calls `processor` for each signal; ACKs after the processor resolves.
 * Returns a stop function.
 */
export async function startSignalConsumer(processor: SignalProcessor): Promise<() => void> {
  await ensureConsumerGroup();
  await drainPending(processor);

  let running = true;
  const redis = getRedisClient();

  logger.info({ event: "consumer.started" }, "Signal consumer started");

  // Run the read loop in the background
  void (async () => {
    while (running) {
      try {
        const results = await redis.xreadgroup(
          "GROUP",
          CONSUMER_GROUP,
          CONSUMER_NAME,
          "COUNT",
          COUNT,
          "BLOCK",
          BLOCK_MS,
          "STREAMS",
          TRADE_SIGNALS_STREAM,
          ">",
        ) as Array<[string, Array<[string, string[]]>]> | null;

        if (!results) continue; // timeout — loop again

        for (const [, entries] of results) {
          for (const [entryId, fields] of entries) {
            if (!fields?.length) continue;
            try {
              const signal = deserialiseStreamEntry(fields);
              signal.streamId = entryId;
              await processor(signal, entryId);
              await redis.xack(TRADE_SIGNALS_STREAM, CONSUMER_GROUP, entryId);
            } catch (err: unknown) {
              logger.error(
                { event: "consumer.processing_failed", entryId, err },
                "Signal processing failed — entry stays in PEL for retry",
              );
              // Do NOT ack — entry remains in PEL and will be reclaimed on next restart
            }
          }
        }
      } catch (err: unknown) {
        if (!running) break;
        logger.error({ event: "consumer.read_error", err }, "XREADGROUP error — retrying");
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
    logger.info({ event: "consumer.stopped" }, "Signal consumer stopped");
  })();

  return () => {
    running = false;
  };
}

/**
 * Check whether a signal has already been processed for a subscriber.
 * Used by the executor to enforce idempotency.
 */
export function buildIdempotencyKey(signalId: string, subscriberId: string): string {
  return `${signalId}:${subscriberId}`;
}
