/**
 * Redis Stream publisher.
 *
 * Writes normalised TradeSignal entries to the "trade-signals" stream.
 * Each entry is stored as a flat key-value hash (Redis Streams require string values).
 *
 * Stream key: trade-signals
 * Entry fields: id, symbol, side, signalType, masterPrice, masterSize,
 *               masterPositionId, timestamp
 */

import type { TradeSignal } from "@kopix/shared";
import { getRedisClient } from "./redisClient.js";
import { logger } from "../logger.js";

export const TRADE_SIGNALS_STREAM = "trade-signals";

/**
 * Publish a single TradeSignal to the Redis stream.
 * Returns the Redis stream entry ID (e.g. "1713393600000-0").
 *
 * Resilience: if Redis is unreachable, the signal is buffered in memory
 * (bounded — see BUFFER_MAX). A background drainer flushes the buffer
 * once Redis recovers. If the buffer is full, the oldest signal is
 * evicted and a CRITICAL log fires — the operator must investigate.
 */
const BUFFER_MAX = Number(process.env["SIGNAL_BUFFER_MAX"] ?? 1000);
const buffer: TradeSignal[] = [];
let drainerStarted = false;

async function xaddSignal(signal: TradeSignal): Promise<string> {
  const redis = getRedisClient();
  const streamId = await redis.xadd(
    TRADE_SIGNALS_STREAM,
    "*",
    "id", signal.id,
    "symbol", signal.symbol,
    "side", signal.side,
    "signalType", signal.signalType,
    "masterPrice", String(signal.masterPrice),
    "masterSize", String(signal.masterSize),
    "masterPositionId", signal.masterPositionId,
    "timestamp", String(signal.timestamp),
    "correlationId", signal.correlationId ?? "",
  );
  if (!streamId) throw new Error("publishSignal: xadd returned null");
  return streamId;
}

function startDrainerOnce(): void {
  if (drainerStarted) return;
  drainerStarted = true;
  setInterval(async () => {
    if (buffer.length === 0) return;
    while (buffer.length > 0) {
      const next = buffer[0]!;
      try {
        const id = await xaddSignal(next);
        buffer.shift();
        logger.info(
          { event: "stream.buffered_published", signalId: next.id, streamId: id, remaining: buffer.length },
          "Recovered buffered signal",
        );
      } catch (err: unknown) {
        // Still down — try again next tick.
        logger.warn(
          { event: "stream.drain_retry", err: String(err), bufferDepth: buffer.length },
          "Buffered signal flush still failing",
        );
        return;
      }
    }
  }, 2_000);
}

export async function publishSignal(signal: TradeSignal): Promise<string> {
  startDrainerOnce();

  try {
    const streamId = await xaddSignal(signal);
    logger.info(
      { event: "stream.published", signalId: signal.id, streamId, symbol: signal.symbol },
      "Signal published to Redis stream",
    );
    return streamId;
  } catch (err: unknown) {
    // Redis unreachable. Buffer in memory; drainer will flush.
    if (buffer.length >= BUFFER_MAX) {
      const dropped = buffer.shift();
      logger.fatal(
        {
          event: "stream.buffer_overflow",
          bufferMax: BUFFER_MAX,
          droppedSignalId: dropped?.id,
        },
        `Signal buffer overflow — dropping oldest signal. Redis has been down too long.`,
      );
    }
    buffer.push(signal);
    logger.error(
      {
        event: "stream.publish_buffered",
        signalId: signal.id,
        bufferDepth: buffer.length,
        err: String(err),
      },
      "Redis publish failed — signal buffered in memory",
    );
    return `buffered:${signal.id}`;
  }
}

/** For tests / ops introspection. */
export function _bufferDepth(): number {
  return buffer.length;
}

/**
 * Deserialise a flat Redis stream entry back into a TradeSignal.
 * Redis entries arrive as alternating [field, value, field, value, ...] arrays.
 */
export function deserialiseStreamEntry(fields: string[]): TradeSignal {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length - 1; i += 2) {
    const key = fields[i];
    const val = fields[i + 1];
    if (key !== undefined && val !== undefined) {
      map[key] = val;
    }
  }

  const out: TradeSignal = {
    id: map["id"] ?? "",
    symbol: map["symbol"] ?? "",
    side: (map["side"] ?? "") as TradeSignal["side"],
    signalType: (map["signalType"] ?? "") as TradeSignal["signalType"],
    masterPrice: parseFloat(map["masterPrice"] ?? "0"),
    masterSize: parseFloat(map["masterSize"] ?? "0"),
    masterPositionId: map["masterPositionId"] ?? "",
    timestamp: parseInt(map["timestamp"] ?? "0", 10),
  };
  if (map["correlationId"]) out.correlationId = map["correlationId"];
  return out;
}
