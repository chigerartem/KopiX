import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { redis } from "../redis.js";
import { config } from "../config.js";

/**
 * Build an "Open Mini App" button. Subscriptions are purchased inside the
 * Mini App (architecture rule), so every expiry message must drive there.
 * Falls back to no-keyboard if MINIAPP_URL is not configured.
 */
function miniAppKeyboard(label: string): InlineKeyboard | undefined {
  if (!config.miniAppUrl) return undefined;
  return new InlineKeyboard().webApp(label, config.miniAppUrl);
}

const INTERVAL_MS = 15 * 60 * 1000;
// How far back to scan for expired subscriptions. With Redis dedup, re-runs are no-ops.
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export function startExpiryNotifications(bot: Bot): void {
  setTimeout(() => void runExpiryCheck(bot), 10_000);
  setInterval(() => void runExpiryCheck(bot), INTERVAL_MS);
}

async function runExpiryCheck(bot: Bot): Promise<void> {
  const now = new Date();
  logger.info({ event: "bot.expiry_check.start" }, "Running subscription expiry check");
  try {
    await notify24h(bot, now);
    await notify1h(bot, now);
    await notifyExpired(bot, now);
  } catch (err) {
    logger.error(
      { event: "bot.expiry_check.error", err: (err as Error).message },
      "Expiry check failed",
    );
  }
}

async function notify24h(bot: Bot, now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const subs = await prisma.subscription.findMany({
    where: { status: "active", expiresAt: { gt: windowStart, lte: windowEnd } },
    include: { subscriber: true, plan: true },
  });

  for (const sub of subs) {
    const key = `notif:${sub.id}:24h`;
    if (await redis.exists(key)) continue;

    const sent = await safeSend(
      bot,
      Number(sub.subscriber.telegramId),
      `⚠️ Your KopiX «${sub.plan.name}» subscription expires in about 24 hours.\n\nRenew now in the Mini App to avoid losing access.`,
      miniAppKeyboard("Open Mini App"),
    );

    if (sent) await redis.set(key, "1", "EX", 48 * 3600);
  }
}

async function notify1h(bot: Bot, now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() + 50 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 70 * 60 * 1000);

  const subs = await prisma.subscription.findMany({
    where: { status: "active", expiresAt: { gt: windowStart, lte: windowEnd } },
    include: { subscriber: true, plan: true },
  });

  for (const sub of subs) {
    const key = `notif:${sub.id}:1h`;
    if (await redis.exists(key)) continue;

    const sent = await safeSend(
      bot,
      Number(sub.subscriber.telegramId),
      `⚠️ Your KopiX «${sub.plan.name}» subscription expires in less than 1 hour.\n\nRenew in the Mini App now to keep copy-trading active.`,
      miniAppKeyboard("Open Mini App"),
    );

    if (sent) await redis.set(key, "1", "EX", 2 * 3600);
  }
}

// Sends "expired" notification once per subscription (Redis dedup).
// DB lifecycle (marking status='expired') is handled by the api-server expiry job.
async function notifyExpired(bot: Bot, now: Date): Promise<void> {
  const lookbackStart = new Date(now.getTime() - LOOKBACK_MS);

  const expired = await prisma.subscription.findMany({
    where: { expiresAt: { lt: now, gt: lookbackStart } },
    include: { subscriber: true },
  });

  for (const sub of expired) {
    const key = `notif:${sub.id}:expired`;
    if (await redis.exists(key)) continue;

    const sent = await safeSend(
      bot,
      Number(sub.subscriber.telegramId),
      "⏰ Your KopiX subscription has expired. Copy-trading is now paused.\n\nRenew in the Mini App to resume.",
      miniAppKeyboard("Open Mini App"),
    );

    if (sent) await redis.set(key, "1", "EX", 7 * 24 * 3600);
  }
}

async function safeSend(
  bot: Bot,
  telegramId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<boolean> {
  try {
    await bot.api.sendMessage(telegramId, text, keyboard ? { reply_markup: keyboard } : undefined);
    return true;
  } catch (err) {
    logger.warn(
      { event: "bot.expiry_check.send_failed", telegramId, err: (err as Error).message },
      "Failed to send expiry notification",
    );
    return false;
  }
}
