import { createPrismaClient } from "@kopix/db";
import { logger } from "../logger.js";

const prisma = createPrismaClient();
const INTERVAL_MS = 15 * 60 * 1000;

export function startExpiryJob(): void {
  setTimeout(() => void runExpiry(), 10_000);
  setInterval(() => void runExpiry(), INTERVAL_MS);
}

async function runExpiry(): Promise<void> {
  const now = new Date();
  try {
    const expired = await prisma.subscription.findMany({
      where: { status: "active", expiresAt: { lt: now } },
      select: { id: true, subscriberId: true },
    });

    if (expired.length === 0) return;

    // Mark all found subscriptions as expired in one batch
    await prisma.subscription.updateMany({
      where: { id: { in: expired.map((s) => s.id) }, status: "active" },
      data: { status: "expired" },
    });

    logger.info(
      { event: "expiry_job.expired", count: expired.length },
      `Marked ${expired.length} subscription(s) as expired`,
    );

    // For each affected subscriber, set inactive only if they have no remaining active subs
    const subscriberIds = [...new Set(expired.map((s) => s.subscriberId))];
    for (const subscriberId of subscriberIds) {
      const remaining = await prisma.subscription.count({
        where: { subscriberId, status: "active", expiresAt: { gt: now } },
      });

      if (remaining === 0) {
        await prisma.subscriber.update({
          where: { id: subscriberId },
          data: { status: "inactive" },
        });
      }
    }
  } catch (err) {
    logger.error(
      { event: "expiry_job.error", err: (err as Error).message },
      "Expiry job failed",
    );
  }
}
