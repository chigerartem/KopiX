import { createPrismaClient } from "@kopix/db";
import { logger } from "../logger.js";

const prisma = createPrismaClient();
const INTERVAL_MS = 15 * 60 * 1000;

export function startExpiryJob(): void {
  setTimeout(() => void runExpiry(), 10_000);
  setInterval(() => void runExpiry(), INTERVAL_MS);
}

/**
 * Two atomic SQL statements (in a single transaction):
 *   1. Mark every active-but-past-expiry subscription as expired.
 *   2. For affected subscribers, set status=inactive ONLY IF they have no
 *      other still-active subscription.
 *
 * The EXISTS-check in step 2 runs in the SAME transaction snapshot, so a
 * concurrent "buy new plan" cannot lose: either the new subscription is
 * already visible (subscriber stays active) or it commits AFTER this job and
 * its own DB write keeps the subscriber active.
 */
async function runExpiry(): Promise<void> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const expiredCount: number = await tx.$executeRaw`
        UPDATE subscriptions
        SET status = 'expired'::"SubscriptionStatus"
        WHERE status = 'active'::"SubscriptionStatus"
          AND "expiresAt" < NOW()
      `;

      if (expiredCount === 0) return { expiredCount: 0, deactivatedCount: 0 };

      const deactivatedCount: number = await tx.$executeRaw`
        UPDATE subscribers s
        SET status = 'inactive'::"SubscriberStatus"
        WHERE s.status = 'active'::"SubscriberStatus"
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions sub
            WHERE sub."subscriberId" = s.id
              AND sub.status = 'active'::"SubscriptionStatus"
              AND sub."expiresAt" > NOW()
          )
      `;

      return { expiredCount, deactivatedCount };
    });

    if (result.expiredCount > 0) {
      logger.info(
        { event: "expiry_job.expired", ...result },
        `Expired ${result.expiredCount} subscription(s); deactivated ${result.deactivatedCount} subscriber(s)`,
      );
    }
  } catch (err) {
    logger.error(
      { event: "expiry_job.error", err: (err as Error).message },
      "Expiry job failed",
    );
  }
}
