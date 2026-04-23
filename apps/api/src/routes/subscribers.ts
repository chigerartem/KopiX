/**
 * Subscriber profile routes:
 *   GET  /api/subscribers/me  — profile, active subscription, copy config
 *   PATCH /api/subscribers/me — update copy mode, fixedAmount, percentage, maxPositionUsdt
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createPrismaClient } from "@kopix/db";
import { CopyMode } from "@kopix/shared";
import { requireTmaAuth } from "../middleware/auth.js";

const prisma = createPrismaClient();

const PatchBody = z.object({
  copyMode: z.nativeEnum(CopyMode).optional(),
  fixedAmount: z.number().positive().optional(),
  percentage: z.number().min(0.01).max(100).optional(),
  maxPositionUsdt: z.number().positive().nullable().optional(),
  action: z.enum(["pause", "resume"]).optional(),
});

export async function subscriberRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/subscribers/me
  app.get(
    "/api/subscribers/me",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const subscriber = await prisma.subscriber.findUniqueOrThrow({
        where: { id: request.subscriberId },
      });

      const activeSubscription = await prisma.subscription.findFirst({
        where: {
          subscriberId: subscriber.id,
          status: "active",
          expiresAt: { gt: new Date() },
        },
        include: { plan: true },
        orderBy: { expiresAt: "desc" },
      });

      await reply.send({
        id: subscriber.id,
        telegramId: subscriber.telegramId.toString(),
        telegramUsername: subscriber.telegramUsername,
        copyMode: subscriber.copyMode,
        fixedAmount: subscriber.fixedAmount ? Number(subscriber.fixedAmount) : null,
        percentage: subscriber.percentage ? Number(subscriber.percentage) : null,
        maxPositionUsdt: subscriber.maxPositionUsdt ? Number(subscriber.maxPositionUsdt) : null,
        status: subscriber.status,
        hasExchangeConnected: !!(subscriber.apiKeyEncrypted && subscriber.apiSecretEncrypted),
        subscription: activeSubscription
          ? {
              id: activeSubscription.id,
              status: activeSubscription.status,
              startedAt: activeSubscription.startedAt,
              expiresAt: activeSubscription.expiresAt,
              planName: activeSubscription.plan.name,
              amountPaid: Number(activeSubscription.amountPaid ?? 0),
              currency: activeSubscription.currency ?? "USDT",
            }
          : null,
      });
    },
  );

  // PATCH /api/subscribers/me
  app.patch(
    "/api/subscribers/me",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const parseResult = PatchBody.safeParse(request.body);
      if (!parseResult.success) {
        await reply.status(400).send({ error: "Invalid request body", details: parseResult.error.flatten() });
        return;
      }

      const { copyMode, fixedAmount, percentage, maxPositionUsdt, action } = parseResult.data;

      // Handle pause / resume actions
      if (action === "pause") {
        const sub = await prisma.subscriber.findUniqueOrThrow({ where: { id: request.subscriberId } });
        if (sub.status !== "active") {
          await reply.status(400).send({ error: "Only active subscribers can be paused" });
          return;
        }
        const updated = await prisma.subscriber.update({
          where: { id: request.subscriberId },
          data: { status: "paused" },
        });
        await reply.send({ status: updated.status });
        return;
      }

      if (action === "resume") {
        const sub = await prisma.subscriber.findUniqueOrThrow({
          where: { id: request.subscriberId },
          include: {
            subscriptions: {
              where: { status: "active", expiresAt: { gt: new Date() } },
              take: 1,
            },
          },
        });
        if (sub.status !== "paused") {
          await reply.status(400).send({ error: "Only paused subscribers can be resumed" });
          return;
        }
        if (!sub.apiKeyEncrypted || !sub.apiSecretEncrypted) {
          await reply.status(400).send({ error: "No BingX API keys connected" });
          return;
        }
        if (sub.subscriptions.length === 0) {
          await reply.status(400).send({ error: "No active subscription" });
          return;
        }
        const updated = await prisma.subscriber.update({
          where: { id: request.subscriberId },
          data: { status: "active" },
        });
        await reply.send({ status: updated.status });
        return;
      }

      // Settings update (copyMode, amounts)
      if (copyMode === CopyMode.Fixed && fixedAmount == null) {
        await reply.status(400).send({ error: "fixedAmount is required for fixed copy mode" });
        return;
      }
      if (copyMode === CopyMode.Percentage && percentage == null) {
        await reply.status(400).send({ error: "percentage is required for percentage copy mode" });
        return;
      }

      const updated = await prisma.subscriber.update({
        where: { id: request.subscriberId },
        data: {
          ...(copyMode !== undefined && { copyMode }),
          ...(fixedAmount !== undefined && { fixedAmount }),
          ...(percentage !== undefined && { percentage }),
          ...(maxPositionUsdt !== undefined && { maxPositionUsdt }),
        },
      });

      await reply.send({
        copyMode: updated.copyMode,
        fixedAmount: updated.fixedAmount ? Number(updated.fixedAmount) : null,
        percentage: updated.percentage ? Number(updated.percentage) : null,
        maxPositionUsdt: updated.maxPositionUsdt ? Number(updated.maxPositionUsdt) : null,
      });
    },
  );
}
