/**
 * Shared Redis client for the bot.
 *
 * Used for transient conversation state (e.g. /connect step 1 → step 2).
 * All keys MUST carry a TTL so orphaned state can never accumulate.
 */

import { Redis } from "ioredis";
import { logger } from "./logger.js";

function buildRedis(): Redis {
  const url = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
  client.on("error", (err: Error) => {
    logger.error({ event: "bot.redis_error", err: err.message }, "Redis error");
  });
  return client;
}

export const redis = buildRedis();
