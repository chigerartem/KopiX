import { createServer } from "node:http";
import { Registry, Gauge, Counter, Histogram, collectDefaultMetrics } from "prom-client";
import { logger } from "./logger.js";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const masterWatcherConnected = new Gauge({
  name: "kopix_master_watcher_connected",
  help: "1 if master watcher WebSocket is connected, 0 otherwise",
  registers: [registry],
});

export const masterWatcherLastEventTs = new Gauge({
  name: "kopix_master_watcher_last_event_timestamp_seconds",
  help: "Unix timestamp of the last message received from BingX WebSocket",
  registers: [registry],
});

export const signalsPublishedTotal = new Counter({
  name: "kopix_signals_published_total",
  help: "Total trade signals published to Redis stream",
  registers: [registry],
});

export const signalsProcessedTotal = new Counter({
  name: "kopix_signals_processed_total",
  help: "Total trade signals processed",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const tradesExecutedTotal = new Counter({
  name: "kopix_trades_executed_total",
  help: "Total copy trades placed across all subscribers",
  labelNames: ["status"] as const,
  registers: [registry],
});

// ── Latency histograms ───────────────────────────────────────────────────────
// Architecture target: < 800ms from master fill to first subscriber order.
// Buckets densely cover that range and extend to 30s for outlier debugging.
const LATENCY_BUCKETS_SEC = [
  0.05, 0.1, 0.25, 0.5, 0.8, 1, 2, 5, 10, 30,
];

/** End-to-end latency: master exchange event timestamp → signal published. */
export const signalIngestLatencySeconds = new Histogram({
  name: "kopix_signal_ingest_latency_seconds",
  help: "Seconds between BingX event timestamp and signal publish to Redis stream",
  buckets: LATENCY_BUCKETS_SEC,
  registers: [registry],
});

/** End-to-end latency: master exchange event → all subscribers processed. */
export const signalEndToEndLatencySeconds = new Histogram({
  name: "kopix_signal_e2e_latency_seconds",
  help: "Seconds between BingX event timestamp and final processSignal completion",
  buckets: LATENCY_BUCKETS_SEC,
  registers: [registry],
});

/** Duration of a single subscriber's order placement (incl. retries). */
export const subscriberExecutionSeconds = new Histogram({
  name: "kopix_subscriber_execution_seconds",
  help: "Time to execute one subscriber's copy of a signal",
  buckets: LATENCY_BUCKETS_SEC,
  labelNames: ["status"] as const,
  registers: [registry],
});

/** Duration of an outbound BingX REST/WS call. */
export const bingxCallSeconds = new Histogram({
  name: "kopix_bingx_call_seconds",
  help: "Latency of outbound BingX calls (placeOrder, fetchBalance, validate)",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  labelNames: ["op", "outcome"] as const,
  registers: [registry],
});

/** Number of subscribers fanned out per signal. */
export const subscribersPerSignal = new Histogram({
  name: "kopix_subscribers_per_signal",
  help: "Number of active subscribers a signal was fanned out to",
  buckets: [0, 1, 10, 50, 100, 500, 1000, 5000, 10000],
  registers: [registry],
});

/**
 * Health probe state. The watcher updates `lastEventTs` (gauge above) and
 * `connected` (gauge); we read them off prom-client and combine with a
 * staleness window. If the master watcher hasn't connected, or hasn't seen
 * data for more than READY_STALE_MS, the engine reports NOT READY so the
 * orchestrator can quickly detect a stuck pod / split-brain.
 */
const READY_STALE_MS = 5 * 60 * 1000; // 5 min

export function startMetricsServer(port = 9090): void {
  const server = createServer(async (req, res) => {
    if (req.url === "/health/live") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url === "/health/ready") {
      const connected = (await masterWatcherConnected.get()).values[0]?.value ?? 0;
      const lastEvent = (await masterWatcherLastEventTs.get()).values[0]?.value ?? 0;
      const ageMs = lastEvent > 0 ? Date.now() - lastEvent * 1000 : Infinity;
      // Only require fresh data after we've seen at least one event — a
      // brand-new engine boot in a quiet trading window must not 503 forever.
      const stale = lastEvent > 0 && ageMs > READY_STALE_MS;
      const ready = connected === 1 && !stale;
      res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: ready ? "ok" : "unavailable",
          masterConnected: connected === 1,
          lastEventAgeSeconds: lastEvent > 0 ? Math.round(ageMs / 1000) : null,
        }),
      );
      return;
    }

    const metrics = await registry.metrics();
    res.writeHead(200, { "Content-Type": registry.contentType });
    res.end(metrics);
  });

  server.listen(port, () => {
    logger.info({ event: "metrics.started", port }, `Prometheus + health on :${port}`);
  });
}
