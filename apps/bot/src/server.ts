/**
 * Fastify server hosting the Telegram webhook.
 *
 * Route: POST /api/bot/webhook
 *
 * Security (architecture §12.4, §13.4):
 *   Telegram sends `X-Telegram-Bot-Api-Secret-Token` on every webhook hit.
 *   The token must equal the `secret_token` passed to `setWebhook`.
 *   Any request without a matching token is rejected with 401 — this is
 *   the ONLY authentication layer for webhook traffic, so it MUST run
 *   before the grammY handler.
 */

import Fastify from "fastify";
import type { Bot } from "grammy";
import { webhookCallback } from "grammy";

export interface BuildServerOptions {
  bot: Bot;
  secretToken: string;
}

export async function buildServer(opts: BuildServerOptions) {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      name: "bot-server",
    },
    trustProxy: true,
  });

  const handleUpdate = webhookCallback(opts.bot, "fastify");

  // Liveness probe — simple, unauthenticated
  app.get("/health/live", async (_req, reply) => {
    await reply.status(200).send({ status: "ok" });
  });

  app.post("/api/bot/webhook", async (request, reply) => {
    const header = request.headers["x-telegram-bot-api-secret-token"];
    if (header !== opts.secretToken) {
      request.log.warn(
        { event: "bot.webhook.bad_token", ip: request.ip },
        "Webhook request rejected — bad secret token",
      );
      await reply.status(401).send({ error: "Unauthorized" });
      return;
    }

    // Delegate to grammY
    await handleUpdate(request, reply);
  });

  return app;
}
