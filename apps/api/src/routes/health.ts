/**
 * Health endpoints (architecture §17.4):
 *   GET /health/live  → 200 if process is alive (liveness probe)
 *   GET /health/ready → 200 if DB and Redis are reachable (readiness probe)
 */

import type { FastifyInstance } from "fastify";
import { createPrismaClient } from "@kopix/db";
import { getRedisClient } from "../plugins/redis.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const prisma = createPrismaClient();

  app.get("/health/live", async (_req, reply) => {
    await reply.status(200).send({ status: "ok" });
  });

  app.get("/health/ready", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await getRedisClient().ping();
      await reply.status(200).send({ status: "ok" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await reply.status(503).send({ status: "unavailable", error: message });
    }
  });
}
