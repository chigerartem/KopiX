import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { getRedisClient } from "./plugins/redis.js";
import { healthRoutes } from "./routes/health.js";
import { exchangeRoutes } from "./routes/exchange.js";
import { subscriberRoutes } from "./routes/subscribers.js";
import { tradeRoutes } from "./routes/trades.js";
import { streamRoutes } from "./routes/stream.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      name: "api-server",
    },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: process.env["CORS_ORIGIN"] ?? true,
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
  await app.register(tradeRoutes);
  await app.register(streamRoutes);

  return app;
}
