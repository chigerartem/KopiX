/**
 * Periodic BingX key re-validation.
 *
 * Subscribers connect their key once. Between then and the next time the
 * engine actually places an order for them, BingX permissions may change:
 *   - the user enabled withdraw permission (now unsafe — must disconnect)
 *   - the key was revoked entirely
 *   - the user switched to one-way mode (would corrupt position tracking)
 *
 * This job runs daily across all connected subscribers, calling
 * @kopix/exchange.validateCredentials. On any failure mode we clear the
 * stored credentials, suspend the subscriber, and publish an account event
 * so the bot can notify them.
 */

import { createPrismaClient } from "@kopix/db";
import { validateCredentials } from "@kopix/exchange";
import { decrypt } from "@kopix/crypto";
import { Redis } from "ioredis";
import { logger } from "../logger.js";

const prisma = createPrismaClient();

// Re-validate every 24h — frequent enough to catch most permission changes
// before the next master trade, infrequent enough to stay well under BingX
// rate limits even at 5000+ subscribers.
const INTERVAL_MS = 24 * 60 * 60 * 1000;
// Stagger inside the run loop so we don't burst all checks at once.
const PER_KEY_DELAY_MS = 250;

export function startKeyRevalidationJob(): void {
  // First run 30s after boot — give the system time to settle.
  setTimeout(() => void run(), 30_000);
  setInterval(() => void run(), INTERVAL_MS);
}

async function run(): Promise<void> {
  const encKey = process.env["APP_ENCRYPTION_KEY"];
  if (!encKey) {
    logger.warn(
      { event: "revalidate_keys.skipped" },
      "APP_ENCRYPTION_KEY not set — skipping key re-validation",
    );
    return;
  }

  const redisUrl = process.env["REDIS_URL"];
  const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 }) : null;

  let checked = 0;
  let revoked = 0;

  try {
    const subs = await prisma.subscriber.findMany({
      where: {
        apiKeyEncrypted: { not: null },
        apiSecretEncrypted: { not: null },
      },
      select: { id: true, apiKeyEncrypted: true, apiSecretEncrypted: true },
    });

    logger.info(
      { event: "revalidate_keys.start", count: subs.length },
      `Revalidating ${subs.length} BingX key(s)`,
    );

    for (const sub of subs) {
      checked++;
      let apiKey: string;
      let apiSecret: string;
      try {
        apiKey = decrypt(sub.apiKeyEncrypted!, encKey);
        apiSecret = decrypt(sub.apiSecretEncrypted!, encKey);
      } catch {
        // Bad ciphertext — clear so the engine doesn't keep trying.
        await disconnect(sub.id, "auth_failed");
        revoked++;
        continue;
      }

      let result;
      try {
        result = await validateCredentials({ apiKey, apiSecret });
      } catch (err: unknown) {
        logger.warn(
          { event: "revalidate_keys.probe_error", subscriberId: sub.id, err: String(err) },
          "validateCredentials threw — leaving key in place this cycle",
        );
        await sleep(PER_KEY_DELAY_MS);
        continue;
      }

      // Auth invalid OR withdraw permission gained → revoke
      if (!result.valid) {
        await disconnect(sub.id, "auth_failed");
        await publish(redis, sub.id, "auth_failed");
        revoked++;
      } else if (result.hasWithdrawPermission) {
        await disconnect(sub.id, "withdraw_permission_added");
        await publish(redis, sub.id, "withdraw_permission_added");
        revoked++;
      }
      // isHedgeMode === false would also be unsafe; we don't auto-revoke for
      // it because the user may have toggled it temporarily and it's
      // recoverable without a key reconnect. The engine still gates on it
      // implicitly via order failures.

      await sleep(PER_KEY_DELAY_MS);
    }

    logger.info(
      { event: "revalidate_keys.done", checked, revoked },
      `Revalidated ${checked} key(s); revoked ${revoked}`,
    );
  } catch (err: unknown) {
    logger.error(
      { event: "revalidate_keys.error", err: String(err) },
      "Key revalidation job failed",
    );
  } finally {
    if (redis) await redis.quit().catch(() => undefined);
  }
}

async function disconnect(subscriberId: string, _reason: string): Promise<void> {
  await prisma.subscriber.update({
    where: { id: subscriberId },
    data: {
      apiKeyEncrypted: null,
      apiSecretEncrypted: null,
      status: "suspended",
    },
  });
}

async function publish(
  redis: Redis | null,
  subscriberId: string,
  reason: "auth_failed" | "withdraw_permission_added",
): Promise<void> {
  if (!redis) return;
  try {
    await redis.publish(
      `account:${subscriberId}`,
      JSON.stringify({ type: "key_revoked", reason }),
    );
  } catch (err: unknown) {
    logger.warn(
      { event: "revalidate_keys.publish_failed", subscriberId, err: String(err) },
      "Failed to publish key-revoked event",
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
