import type { Bot, CommandContext, Context } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";

async function handlePause(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ Команда /pause работает только в личном чате с ботом.");
    return;
  }
  if (!ctx.from) return;

  const subscriber = await prisma.subscriber.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
  });

  if (!subscriber) {
    await ctx.reply("Вы ещё не зарегистрированы. Отправьте /start, чтобы начать.");
    return;
  }

  if (subscriber.status === "paused") {
    await ctx.reply("Копирование уже на паузе. Возобновите через /resume.");
    return;
  }

  if (subscriber.status !== "active") {
    await ctx.reply(
      "Нечего ставить на паузу — копирование ещё не активно.\nОтправьте /status, чтобы проверить ваш статус.",
    );
    return;
  }

  await prisma.subscriber.update({
    where: { id: subscriber.id },
    data: { status: "paused" },
  });

  logger.info(
    { event: "bot.pause", telegramId: ctx.from.id },
    "Subscriber paused",
  );

  await ctx.reply(
    "⏸ Копирование приостановлено. Открытые позиции остаются как есть.\n\nВозобновите через /resume.",
  );
}

async function handleResume(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ Команда /resume работает только в личном чате с ботом.");
    return;
  }
  if (!ctx.from) return;

  const subscriber = await prisma.subscriber.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
    include: {
      subscriptions: {
        where: { status: "active", expiresAt: { gt: new Date() } },
        take: 1,
      },
    },
  });

  if (!subscriber) {
    await ctx.reply("Вы ещё не зарегистрированы. Отправьте /start, чтобы начать.");
    return;
  }

  if (subscriber.status !== "paused") {
    await ctx.reply(
      "Вы не на паузе.\nОтправьте /status, чтобы проверить текущее состояние.",
    );
    return;
  }

  const hasKeys = !!(subscriber.apiKeyEncrypted && subscriber.apiSecretEncrypted);
  const hasSub = subscriber.subscriptions.length > 0;

  if (!hasKeys) {
    await ctx.reply(
      "❌ Нет подключённого аккаунта BingX. Сначала отправьте /connect, затем /resume.",
    );
    return;
  }

  if (!hasSub) {
    await ctx.reply(
      "❌ Нет активной подписки. Сначала оплатите её через /subscribe, затем /resume.",
    );
    return;
  }

  await prisma.subscriber.update({
    where: { id: subscriber.id },
    data: { status: "active" },
  });

  logger.info(
    { event: "bot.resume", telegramId: ctx.from.id },
    "Subscriber resumed",
  );

  await ctx.reply(
    "▶️ Копирование возобновлено! Следующая сделка мастера будет скопирована на ваш аккаунт.",
  );
}

export function registerPauseResumeHandlers(bot: Bot): void {
  bot.command("pause", handlePause);
  bot.command("resume", handleResume);
}
