import type { Bot, CommandContext, Context } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";

async function handlePause(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ /pause only works in a private chat with the bot.");
    return;
  }
  if (!ctx.from) return;

  const subscriber = await prisma.subscriber.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
  });

  if (!subscriber) {
    await ctx.reply("You're not registered yet. Send /start to begin.");
    return;
  }

  if (subscriber.status === "paused") {
    await ctx.reply("Copying is already paused. Resume with /resume.");
    return;
  }

  if (subscriber.status !== "active") {
    await ctx.reply(
      "Nothing to pause — copying isn't active yet.\nSend /status to check your state.",
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
    "⏸ Copying paused. Open positions stay as they are.\n\nResume with /resume.",
  );
}

async function handleResume(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ /resume only works in a private chat with the bot.");
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
    await ctx.reply("You're not registered yet. Send /start to begin.");
    return;
  }

  if (subscriber.status !== "paused") {
    await ctx.reply("You're not paused.\nSend /status to see your current state.");
    return;
  }

  const hasKeys = !!(subscriber.apiKeyEncrypted && subscriber.apiSecretEncrypted);
  const hasSub = subscriber.subscriptions.length > 0;

  if (!hasKeys) {
    await ctx.reply(
      "❌ No BingX account connected. Add an API key in the Mini App, then /resume.",
    );
    return;
  }

  if (!hasSub) {
    await ctx.reply(
      "❌ No active subscription. Pick a plan in the Mini App, then /resume.",
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
    "▶️ Copying resumed! The master's next trade will be copied to your account.",
  );
}

export function registerPauseResumeHandlers(bot: Bot): void {
  bot.command("pause", handlePause);
  bot.command("resume", handleResume);
}
