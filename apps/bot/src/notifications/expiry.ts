import type { Bot } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { redis } from "../redis.js";

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
      `⚠️ Ваша подписка «${sub.plan.name}» истекает примерно через 24 часа.\n\nОтправьте /subscribe, чтобы продлить её заранее.`,
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
      `⚠️ Ваша подписка «${sub.plan.name}» истекает менее чем через час.\n\nОтправьте /subscribe сейчас, чтобы не потерять доступ.`,
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
      "⏰ Ваша подписка KopiX истекла. Копирование сделок остановлено.\n\nОтправьте /subscribe, чтобы продлить.",
    );

    if (sent) await redis.set(key, "1", "EX", 7 * 24 * 3600);
  }
}

async function safeSend(bot: Bot, telegramId: number, text: string): Promise<boolean> {
  try {
    await bot.api.sendMessage(telegramId, text);
    return true;
  } catch (err) {
    logger.warn(
      { event: "bot.expiry_check.send_failed", telegramId, err: (err as Error).message },
      "Failed to send expiry notification",
    );
    return false;
  }
}
