import type { Bot } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { redis } from "../redis.js";

const INTERVAL_MS = 15 * 60 * 1000;

export function startExpiryNotifications(bot: Bot): void {
  setTimeout(() => void runExpiryCheck(bot), 10_000);
  setInterval(() => void runExpiryCheck(bot), INTERVAL_MS);
}

async function runExpiryCheck(bot: Bot): Promise<void> {
  const now = new Date();
  logger.info({ event: "bot.expiry_check.start" }, "Running subscription expiry check");
  try {
    await expireAndNotify(bot, now);
    await notify24h(bot, now);
    await notify1h(bot, now);
  } catch (err) {
    logger.error(
      { event: "bot.expiry_check.error", err: (err as Error).message },
      "Expiry check failed",
    );
  }
}

async function expireAndNotify(bot: Bot, now: Date): Promise<void> {
  const expired = await prisma.subscription.findMany({
    where: { status: "active", expiresAt: { lt: now } },
    include: { subscriber: true, plan: true },
  });

  for (const sub of expired) {
    await prisma.$transaction([
      prisma.subscription.update({ where: { id: sub.id }, data: { status: "expired" } }),
      prisma.subscriber.update({ where: { id: sub.subscriberId }, data: { status: "inactive" } }),
    ]);

    logger.info(
      { event: "bot.expiry_check.expired", subscriptionId: sub.id, subscriberId: sub.subscriberId },
      "Subscription expired",
    );

    await safeSend(
      bot,
      Number(sub.subscriber.telegramId),
      "⏰ Ваша подписка KopiX истекла. Копирование сделок остановлено.\n\nОтправьте /subscribe, чтобы продлить.",
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
