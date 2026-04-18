/**
 * grammY bot factory.
 *
 * The bot instance here registers global middleware (logging, error handler)
 * but no commands — commands are wired in src/handlers/index.ts as they are
 * implemented in subsequent steps.
 */

import { Bot, GrammyError, HttpError } from "grammy";
import { logger } from "./logger.js";

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Basic request logging
  bot.use(async (ctx, next) => {
    const start = Date.now();
    const from = ctx.from?.id;
    const text = ctx.message?.text;
    try {
      await next();
    } finally {
      logger.info(
        {
          event: "bot.update",
          telegramId: from,
          text,
          durationMs: Date.now() - start,
        },
        "Update handled",
      );
    }
  });

  // Global error handler — grammY calls this when a handler throws
  bot.catch((err) => {
    const ctx = err.ctx;
    const telegramId = ctx.from?.id;

    if (err.error instanceof GrammyError) {
      logger.error(
        { event: "bot.telegram_error", telegramId, err: err.error.description },
        "Telegram API error",
      );
    } else if (err.error instanceof HttpError) {
      logger.error(
        { event: "bot.network_error", telegramId, err: err.error.message },
        "Network error contacting Telegram",
      );
    } else {
      logger.error(
        { event: "bot.handler_error", telegramId, err: err.error },
        "Unhandled error in bot handler",
      );
    }
  });

  return bot;
}
