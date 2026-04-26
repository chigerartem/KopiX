/**
 * Token-bucket rate limiter, per-key.
 *
 * Used to gate outbound BingX calls. BingX's published limits (subject to
 * change) are roughly:
 *   - per IP for public endpoints: tens of req/s
 *   - per API key for private endpoints (orders, balance): single-digit
 *     req/s with brief bursts
 *
 * We bucket by `key` (e.g. an API-key fingerprint or "ip:default") so each
 * subscriber's BingX session has its own quota and one slow subscriber
 * cannot starve the rest.
 *
 * The implementation is in-process — fine for a single engine instance
 * (architecture rule). If we ever shard the engine, this needs to move to
 * Redis with INCR + EXPIRE semantics.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

interface BucketConfig {
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
}

const DEFAULT: BucketConfig = {
  capacity: Number(process.env["BINGX_RATE_BURST"] ?? 10),
  refillPerSec: Number(process.env["BINGX_RATE_RPS"] ?? 5),
};

const buckets = new Map<string, Bucket>();

function refill(b: Bucket, cfg: BucketConfig, now: number): void {
  const elapsedSec = (now - b.lastRefill) / 1000;
  if (elapsedSec <= 0) return;
  b.tokens = Math.min(cfg.capacity, b.tokens + elapsedSec * cfg.refillPerSec);
  b.lastRefill = now;
}

/**
 * Acquire one token for `key`. Returns immediately if tokens available;
 * otherwise sleeps just long enough for the next token to refill.
 *
 * Throws if `key` is empty (programmer error — never silently fall through
 * to a global bucket since that would let one bad caller exhaust everyone).
 */
export async function acquireToken(key: string, cfg: BucketConfig = DEFAULT): Promise<void> {
  if (!key) throw new Error("rateLimiter: key is required");

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: cfg.capacity, lastRefill: Date.now() };
    buckets.set(key, b);
  }

  // Loop: if many callers are waiting, each wakeup recomputes.
  for (;;) {
    refill(b, cfg, Date.now());
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    const tokensShort = 1 - b.tokens;
    const waitMs = Math.ceil((tokensShort / cfg.refillPerSec) * 1000);
    await sleep(Math.max(waitMs, 5));
  }
}

/** Periodic GC: drop idle buckets so the map cannot grow unbounded. */
export function pruneIdleBuckets(idleMs = 10 * 60 * 1000): void {
  const cutoff = Date.now() - idleMs;
  for (const [k, b] of buckets) {
    if (b.lastRefill < cutoff) buckets.delete(k);
  }
}

/** For tests. */
export function _resetBuckets(): void {
  buckets.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
