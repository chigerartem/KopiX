/**
 * Telegram bot entry point.
 *
 * Starts a Fastify HTTP server on $BOT_PORT (default 3001) that hosts the
 * webhook route. Commands are registered on the grammY Bot in bot.ts.
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN    — Bot token from @BotFather
 *   BOT_WEBHOOK_SECRET    — matches `secret_token` given to setWebhook
 *   BOT_PORT              — optional, default 3001
 *   BOT_HOST              — optional, default 0.0.0.0
 */

import { createBot } from "./bot.js";
import { buildServer } from "./server.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const secret = process.env["BOT_WEBHOOK_SECRET"];

  if (!token) throw new Error("TELEGRAM_BOT_TOKEN env var is required");
  if (!secret) throw new Error("BOT_WEBHOOK_SECRET env var is required");

  const port = parseInt(process.env["BOT_PORT"] ?? "3001", 10);
  const host = process.env["BOT_HOST"] ?? "0.0.0.0";

  const bot = createBot(token);
  await bot.init(); // fetch bot info so ctx.me is available

  logger.info(
    { event: "bot.initialised", username: bot.botInfo.username },
    `Bot @${bot.botInfo.username} initialised`,
  );

  const app = await buildServer({ bot, secretToken: secret });
  await app.listen({ port, host });

  logger.info(
    { event: "bot.server_started", port, host },
    `Bot webhook listening on ${host}:${port}/api/bot/webhook`,
  );

  const shutdown = async (): Promise<void> => {
    logger.info({ event: "bot.shutdown" }, "Shutting down bot");
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  logger.error({ event: "bot.fatal", err }, "Fatal error — bot exiting");
  process.exit(1);
});
