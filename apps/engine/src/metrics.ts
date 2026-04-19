import { createServer } from "node:http";
import { Registry, Gauge, Counter, collectDefaultMetrics } from "prom-client";
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

export function startMetricsServer(port = 9090): void {
  const server = createServer(async (_req, res) => {
    const metrics = await registry.metrics();
    res.writeHead(200, { "Content-Type": registry.contentType });
    res.end(metrics);
  });

  server.listen(port, () => {
    logger.info({ event: "metrics.started", port }, `Prometheus metrics on :${port}`);
  });
}
