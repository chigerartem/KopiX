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

  // Rate limiting — Redis-backed, keyed by subscriberId when authenticated,
  // IP address otherwise (architecture §25).
  await app.register(rateLimit, {
    global: true,
    max: 60,              // 60 requests per window
    timeWindow: 60_000,   // 1 minute
    redis: getRedisClient(),
    keyGenerator: (request) => {
      // Use subscriber ID for authenticated requests, otherwise IP
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
