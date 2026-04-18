/**
 * Trade Engine entry point.
 *
 * Master account credentials come from env vars:
 *   MASTER_API_KEY    — BingX API key of the master trader
 *   MASTER_API_SECRET — BingX API secret of the master trader
 *
 * Start order:
 *   1. Connect Redis (implicit via first use)
 *   2. Start signal consumer (reads trade-signals stream)
 *   3. Start master account watcher (BingX WebSocket → normalise → publish to stream)
 *   4. On SIGTERM/SIGINT: graceful shutdown
 */

import { startMasterWatcher } from "./watcher/masterWatcher.js";
import { normalizeSignal } from "./normalizer/normalizeSignal.js";
import { publishSignal } from "./redis/streamPublisher.js";
import { startSignalConsumer } from "./consumer/signalConsumer.js";
import { processSignal } from "./engine/signalProcessor.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  logger.info({ event: "engine.starting" }, "Trade engine starting");

  // Master credentials come directly from env — no DB lookup, no encryption layer.
  // Subscriber credentials are encrypted in the DB because they are dynamic and
  // user-supplied; the master account is a single static operator secret.
  const masterApiKey = process.env["MASTER_API_KEY"];
  const masterSecret = process.env["MASTER_API_SECRET"];

  if (!masterApiKey || !masterSecret) {
    throw new Error(
      "MASTER_API_KEY and MASTER_API_SECRET env vars are required",
    );
  }

  // Start signal consumer (processes signals from Redis stream)
  const stopConsumer = await startSignalConsumer(async (signal) => {
    await processSignal(signal);
  });

  // Start master watcher (emits raw BingX events → normalise → publish)
  const watcher = startMasterWatcher(masterApiKey, masterSecret, (rawEvent) => {
    const signal = normalizeSignal(rawEvent);
    if (!signal) return;

    publishSignal(signal).catch((err: unknown) => {
      logger.error({ event: "engine.publish_error", err }, "Failed to publish signal");
    });
  });

  logger.info({ event: "engine.running" }, "Trade engine running");

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info({ event: "engine.shutdown" }, "Shutting down trade engine");
    watcher.stop();
    stopConsumer();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  logger.error({ event: "engine.fatal", err }, "Fatal error — engine exiting");
  process.exit(1);
});
