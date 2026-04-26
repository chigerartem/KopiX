/**
 * Redis-backed subscriber balance cache.
 *
 * Why: percentage-mode sizing fetches the BingX balance for every signal.
 * At 5000 subscribers × dozens of signals/hour, that's hundreds of thousands
 * of BingX `fetchBalance` calls a day — easily blown past rate limits and
 * adding ~150ms latency per signal-per-subscriber (network).
 *
 * The cache keeps the balance for `TTL_SECONDS` per subscriber. Stale by
 * design: copy-trading sizes are inherently approximate, and stale-by-30s is
 * far better than rate-limit failures or 30s queue depth.
 */

import { getBalance } from "@kopix/exchange";
import type { Balance, Credentials } from "@kopix/exchange";
import { getRedisClient } from "../redis/redisClient.js";
import { logger } from "../logger.js";

const TTL_SECONDS = Number(process.env["BALANCE_CACHE_TTL_SECONDS"] ?? 30);
const KEY_PREFIX = "bal:";

/**
 * Returns the cached balance if still fresh, otherwise fetches from BingX
 * and writes through to the cache. On Redis errors we degrade gracefully —
 * fetch from BingX directly and skip caching for this call.
 */
export async function getCachedBalance(
  subscriberId: string,
  credentials: Credentials,
): Promise<Balance> {
  const redis = getRedisClient();
  const key = KEY_PREFIX + subscriberId;

  try {
    const cached = await redis.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as Balance;
      if (
        typeof parsed.available === "number" &&
        typeof parsed.total === "number" &&
        typeof parsed.currency === "string"
      ) {
        return parsed;
      }
    }
  } catch (err: unknown) {
    logger.warn(
      { event: "balance_cache.read_failed", subscriberId, err: String(err) },
      "Balance cache read failed — falling through to BingX",
    );
  }

  const fresh = await getBalance(credentials);

  try {
    await redis.set(key, JSON.stringify(fresh), "EX", TTL_SECONDS);
  } catch (err: unknown) {
    logger.warn(
      { event: "balance_cache.write_failed", subscriberId, err: String(err) },
      "Balance cache write failed — continuing without cache",
    );
  }

  return fresh;
}

/** Manually invalidate (e.g. after a known balance-changing action). */
export async function invalidateBalance(subscriberId: string): Promise<void> {
  try {
    await getRedisClient().del(KEY_PREFIX + subscriberId);
  } catch {
    // Silent — invalidate is best-effort.
  }
}
