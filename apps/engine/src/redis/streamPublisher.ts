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
 */
export async function publishSignal(signal: TradeSignal): Promise<string> {
  const redis = getRedisClient();

  const streamId = await redis.xadd(
    TRADE_SIGNALS_STREAM,
    "*", // auto-generate entry ID
    "id", signal.id,
    "symbol", signal.symbol,
    "side", signal.side,
    "signalType", signal.signalType,
    "masterPrice", String(signal.masterPrice),
    "masterSize", String(signal.masterSize),
    "masterPositionId", signal.masterPositionId,
    "timestamp", String(signal.timestamp),
  );

  if (!streamId) throw new Error("publishSignal: xadd returned null");

  logger.info(
    { event: "stream.published", signalId: signal.id, streamId, symbol: signal.symbol },
    "Signal published to Redis stream",
  );

  return streamId;
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

  return {
    id: map["id"] ?? "",
    symbol: map["symbol"] ?? "",
    side: (map["side"] ?? "") as TradeSignal["side"],
    signalType: (map["signalType"] ?? "") as TradeSignal["signalType"],
    masterPrice: parseFloat(map["masterPrice"] ?? "0"),
    masterSize: parseFloat(map["masterSize"] ?? "0"),
    masterPositionId: map["masterPositionId"] ?? "",
    timestamp: parseInt(map["timestamp"] ?? "0", 10),
  };
}
