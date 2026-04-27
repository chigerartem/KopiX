/**
 * Per-subscriber circuit breaker.
 *
 * Cuts off execution for a single subscriber after N consecutive failures
 * inside a sliding window. Without this, one subscriber with a flaky
 * BingX setup (rate-limited key, transient network, suspended account
 * we haven't auto-revoked yet) generates retry storms that:
 *   1. eat the subscriber-execution semaphore slot
 *   2. waste BingX rate-limit tokens shared with healthy subscribers
 *
 * State machine:
 *   - closed:   normal operation
 *   - open:     reject immediately for OPEN_DURATION_MS
 *   - half_open: after OPEN_DURATION_MS, allow ONE probe; on success
 *     → closed; on failure → open again
 *
 * In-process by design — single engine instance is the architectural
 * invariant, so per-process state is also per-cluster state.
 */

import { logger } from "../logger.js";

const FAILURE_THRESHOLD = Number(process.env["CB_FAILURE_THRESHOLD"] ?? 5);
const FAILURE_WINDOW_MS = Number(process.env["CB_FAILURE_WINDOW_MS"] ?? 30_000);
const OPEN_DURATION_MS = Number(process.env["CB_OPEN_DURATION_MS"] ?? 5 * 60_000);

type State = "closed" | "open" | "half_open";

interface BreakerEntry {
  state: State;
  failures: number[]; // timestamps of failures inside the window
  openedAt: number;
}

const breakers = new Map<string, BreakerEntry>();

function get(key: string): BreakerEntry {
  let b = breakers.get(key);
  if (!b) {
    b = { state: "closed", failures: [], openedAt: 0 };
    breakers.set(key, b);
  }
  return b;
}

function pruneOldFailures(b: BreakerEntry, now: number): void {
  const cutoff = now - FAILURE_WINDOW_MS;
  b.failures = b.failures.filter((t) => t >= cutoff);
}

/**
 * Returns true if the breaker is open and the call should be skipped.
 * If half-open, lets exactly one call through (atomic flip to "open" so
 * concurrent callers don't all probe at once).
 */
export function shouldSkip(key: string): boolean {
  const b = get(key);
  const now = Date.now();

  if (b.state === "open") {
    if (now - b.openedAt >= OPEN_DURATION_MS) {
      b.state = "half_open";
      logger.info(
        { event: "breaker.half_open", key },
        "Circuit breaker entering half-open state",
      );
      return false; // allow this caller to probe
    }
    return true;
  }
  if (b.state === "half_open") {
    // A probe is already in flight; reject everyone else.
    return true;
  }
  return false;
}

export function onSuccess(key: string): void {
  const b = get(key);
  if (b.state !== "closed") {
    logger.info({ event: "breaker.closed", key }, "Circuit breaker closed");
  }
  b.state = "closed";
  b.failures = [];
  b.openedAt = 0;
}

export function onFailure(key: string): void {
  const b = get(key);
  const now = Date.now();
  b.failures.push(now);
  pruneOldFailures(b, now);

  if (b.state === "half_open") {
    // Probe failed → re-open.
    b.state = "open";
    b.openedAt = now;
    logger.warn(
      { event: "breaker.reopened", key },
      "Half-open probe failed — reopening circuit",
    );
    return;
  }

  if (b.state === "closed" && b.failures.length >= FAILURE_THRESHOLD) {
    b.state = "open";
    b.openedAt = now;
    logger.warn(
      {
        event: "breaker.opened",
        key,
        failures: b.failures.length,
        windowMs: FAILURE_WINDOW_MS,
        openDurationMs: OPEN_DURATION_MS,
      },
      `Circuit breaker opened — pausing key for ${OPEN_DURATION_MS / 1000}s`,
    );
  }
}

/** GC for idle entries — call periodically. */
export function pruneIdleBreakers(idleMs = 60 * 60 * 1000): void {
  const cutoff = Date.now() - idleMs;
  for (const [k, b] of breakers) {
    if (b.state === "closed" && b.failures.length === 0 && b.openedAt < cutoff) {
      breakers.delete(k);
    }
  }
}

/** For tests. */
export function _reset(): void {
  breakers.clear();
}
