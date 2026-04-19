import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { getRedisClient } from "./plugins/redis.js";
import { healthRoutes } from "./routes/health.js";
import { exchangeRoutes } from "./routes/exchange.js";
import { subscriberRoutes } from "./routes/subscribers.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { tradeRoutes } from "./routes/trades.js";
import { streamRoutes } from "./routes/stream.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { metricsRoutes } from "./routes/metrics.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      name: "api-server",
    },
    trustProxy: true,
  });

  // CORS — fail closed. In production, CORS_ORIGIN must be set explicitly
  // (e.g. https://app.example.com). Defaulting to `true` (allow-all) would let
  // any origin call authenticated endpoints with credentials.
  const corsOrigin = process.env["CORS_ORIGIN"];
  if (!corsOrigin) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("CORS_ORIGIN must be set in production");
    }
    app.log.warn("CORS_ORIGIN not set — allowing localhost only");
  }
  await app.register(cors, {
    origin: corsOrigin ?? ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
  });

  // Rate limiting — Redis-backed (architecture §25).
  // Registered WITHOUT `global: true` so it does not run before authentication.
  // Each route applies `app.rateLimit(...)` inside its own preHandler chain
  // AFTER requireTmaAuth, guaranteeing `request.subscriberId` is populated
  // before keyGenerator reads it. Anonymous requests fall back to IP.
  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: 60_000,
    redis: getRedisClient(),
    keyGenerator: (request) => {
      const sub = (request as { subscriberId?: string }).subscriberId;
      return sub ?? (request.ip || "unknown");
    },
    errorResponseBuilder: (_request, context) => ({
      error: "Too many requests",
      retryAfter: context.after,
    }),
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(exchangeRoutes);
  await app.register(subscriberRoutes);
  await app.register(subscriptionRoutes);
  await app.register(tradeRoutes);
  await app.register(streamRoutes);
  await app.register(webhookRoutes);
  await app.register(metricsRoutes);

  return app;
}
