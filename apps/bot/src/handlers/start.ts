/**
 * /start — registration and welcome.
 *
 * Flow (architecture §13.2):
 *   - Upsert subscriber by telegram_id
 *   - If new: status = inactive, send welcome + /connect prompt
 *   - If existing: short status summary + hint to /status or /dashboard
 *
 * The upsert is identical to what the API /middleware/auth.ts does for
 * Mini App requests, so subscribers who first use the bot and later open
 * the Mini App (or vice versa) remain a single row keyed on telegram_id.
 */

import type { CommandContext, Context } from "grammy";
import { createPrismaClient } from "@kopix/db";
import { logger } from "../logger.js";

const prisma = createPrismaClient();

export async function handleStart(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) return; // command came from a channel post — ignore

  const telegramId = BigInt(from.id);

  // Detect new vs existing
  const existing = await prisma.subscriber.findUnique({
    where: { telegramId },
  });

  const subscriber = await prisma.subscriber.upsert({
    where: { telegramId },
    update: {
      telegramUsername: from.username ?? null,
    },
    create: {
      telegramId,
      telegramUsername: from.username ?? null,
      status: "inactive",
    },
  });

  const isNew = !existing;

  logger.info(
    { event: "bot.start", telegramId: from.id, subscriberId: subscriber.id, isNew },
    isNew ? "Registered new subscriber" : "Returning subscriber",
  );

  if (isNew) {
    await ctx.reply(
      [
        "👋 Добро пожаловать в KopiX!",
        "",
        "Это сервис автоматического копирования сделок с BingX.",
        "Чтобы начать, подключите свой аккаунт BingX — отправьте /connect.",
        "",
        "После этого выберите подписку через /subscribe.",
      ].join("\n"),
    );
    return;
  }

  const hasExchange = !!(subscriber.apiKeyEncrypted && subscriber.apiSecretEncrypted);

  const parts: string[] = ["С возвращением!"];
  if (!hasExchange) {
    parts.push("", "Вы ещё не подключили BingX — отправьте /connect.");
  } else {
    parts.push(
      "",
      "Текущий статус: /status",
      "Настройки копирования: /mode",
      "Открыть дашборд: /dashboard",
    );
  }

  await ctx.reply(parts.join("\n"));
}
