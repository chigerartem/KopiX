/**
 * GET /api/stream/trades
 *
 * Server-Sent Events endpoint (architecture §14.3).
 * The trade engine publishes to Redis pub/sub channel "trades:{subscriberId}"
 * after each order execution. This handler subscribes and pushes events
 * to the open HTTP connection.
 *
 * SSE format:
 *   data: {"type":"trade_executed","data":{...}}\n\n
 *
 * Nginx config required (already in ARCHITECTURE.md §12.3):
 *   proxy_buffering off;
 *   proxy_cache off;
 *   proxy_http_version 1.1;
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Redis } from "ioredis";
import { requireTmaAuth } from "../middleware/auth.js";
import { logger } from "../logger.js";

const REDIS_URL = () => process.env["REDIS_URL"] ?? "redis://localhost:6379";

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/stream/trades",
    { preHandler: requireTmaAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const subscriberId = request.subscriberId;
      const channel = `trades:${subscriberId}`;

      // Each SSE connection needs its own subscriber client
      const sub = new Redis(REDIS_URL(), { maxRetriesPerRequest: null, lazyConnect: false });

      // SSE headers
      void reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable nginx buffering
      });

      // Heartbeat every 25s to keep the connection alive through proxies
      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(": heartbeat\n\n");
        }
      }, 25_000);

      const cleanup = (): void => {
        clearInterval(heartbeat);
        sub.unsubscribe(channel).catch(() => undefined);
        sub.quit().catch(() => undefined);
        logger.info({ event: "sse.disconnected", subscriberId }, "SSE client disconnected");
      };

      request.raw.on("close", cleanup);
      request.raw.on("aborted", cleanup);

      await sub.subscribe(channel);
      logger.info({ event: "sse.connected", subscriberId, channel }, "SSE client connected");

      sub.on("message", (_ch: string, message: string) => {
        if (reply.raw.writableEnded) return;
        reply.raw.write(`data: ${message}\n\n`);
      });

      sub.on("error", (err: Error) => {
        logger.error({ event: "sse.redis_error", subscriberId, err });
        cleanup();
        if (!reply.raw.writableEnded) reply.raw.end();
      });

      // Keep the handler alive — Fastify must not close the response
      await new Promise<void>((resolve) => {
        request.raw.on("close", resolve);
        request.raw.on("aborted", resolve);
      });
    },
  );
}
