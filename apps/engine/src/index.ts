/**
 * Trade Engine entry point.
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
import { createPrismaClient } from "@kopix/db";
import { decrypt } from "@kopix/crypto";

async function main(): Promise<void> {
  logger.info({ event: "engine.starting" }, "Trade engine starting");

  const encKey = process.env["APP_ENCRYPTION_KEY"];
  if (!encKey) throw new Error("APP_ENCRYPTION_KEY env var is required");

  // Load master account credentials from DB
  const prisma = createPrismaClient();
  const master = await prisma.masterAccount.findFirst({ where: { isActive: true } });
  if (!master) throw new Error("No active master account found in database");

  if (master.apiKeyEncrypted === "PLACEHOLDER") {
    throw new Error(
      "Master account credentials are placeholders — configure real encrypted keys first",
    );
  }

  const masterApiKey = decrypt(master.apiKeyEncrypted, encKey);
  const masterSecret = decrypt(master.apiSecretEncrypted, encKey);

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
    prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  logger.error({ event: "engine.fatal", err }, "Fatal error — engine exiting");
  process.exit(1);
});
