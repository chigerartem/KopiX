import { randomUUID } from "node:crypto";
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
import { adminRoutes } from "./routes/admin.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      name: "api-server",
    },
    trustProxy: true,
    // Correlation ID per request: trust an inbound x-correlation-id header
    // (so callers — bot, mini-app, webhook origin — can stitch traces),
    // otherwise generate a fresh UUID. Fastify auto-injects this into every
    // request.log.* call as `reqId`.
    genReqId: (req) => {
      const inbound = req.headers["x-correlation-id"];
      if (typeof inbound === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(inbound)) {
        return inbound;
      }
      return randomUUID();
    },
    requestIdHeader: "x-correlation-id",
    requestIdLogLabel: "correlationId",
  });

  // Echo the correlation ID back to the caller so they can grep their
  // own logs for the same value if they need support.
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-correlation-id", request.id);
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
  await app.register(adminRoutes);

  return app;
}
