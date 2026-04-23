/**
 * GET /api/trades       — paginated trade history with P&L
 * GET /api/positions    — open positions
 * GET /api/stats        — aggregate P&L, win rate, total trades
 * GET /api/pnl-history  — daily realized-PnL snapshots for charts
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createPrismaClient, type CopiedTrade, type Position, type PnlSnapshot } from "@kopix/db";
import { requireTmaAuth } from "../middleware/auth.js";

const prisma = createPrismaClient();

const TradesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const PnlHistoryQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function tradeRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/trades
  app.get(
    "/api/trades",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const qr = TradesQuery.safeParse(request.query);
      if (!qr.success) {
        await reply.status(400).send({ error: "Invalid query params" });
        return;
      }
      const { limit, offset } = qr.data;

      const [trades, total] = await Promise.all([
        prisma.copiedTrade.findMany({
          where: { subscriberId: request.subscriberId },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.copiedTrade.count({ where: { subscriberId: request.subscriberId } }),
      ]);

      await reply.send({
        total,
        limit,
        offset,
        items: trades.map((t: CopiedTrade) => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          tradeType: t.tradeType,
          orderedSize: Number(t.orderedSize),
          executedSize: t.executedSize ? Number(t.executedSize) : null,
          executedPrice: t.executedPrice ? Number(t.executedPrice) : null,
          masterPrice: Number(t.masterPrice),
          slippagePct: t.slippagePct ? Number(t.slippagePct) : null,
          status: t.status,
          failureReason: t.failureReason,
          executedAt: t.executedAt,
          createdAt: t.createdAt,
        })),
      });
    },
  );

  // GET /api/positions
  app.get(
    "/api/positions",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const positions = await prisma.position.findMany({
        where: { subscriberId: request.subscriberId, status: "open" },
        orderBy: { openedAt: "desc" },
      });

      await reply.send(
        positions.map((p: Position) => ({
          id: p.id,
          symbol: p.symbol,
          side: p.side,
          entryPrice: Number(p.entryPrice),
          size: Number(p.size),
          openedAt: p.openedAt,
        })),
      );
    },
  );

  // GET /api/stats
  app.get(
    "/api/stats",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const [tradeStats, pnlAgg] = await Promise.all([
        prisma.copiedTrade.groupBy({
          by: ["status"],
          where: { subscriberId: request.subscriberId },
          _count: { id: true },
        }),
        prisma.position.aggregate({
          where: { subscriberId: request.subscriberId, status: "closed" },
          _sum: { realizedPnl: true },
          _count: { id: true },
        }),
      ]);

      const countMap: Record<string, number> = {};
      for (const row of tradeStats) {
        countMap[row.status] = row._count.id;
      }

      const totalTrades = Object.values(countMap).reduce((a, b) => a + b, 0);
      const filledTrades = countMap["filled"] ?? 0;
      const failedTrades = countMap["failed"] ?? 0;
      const skippedTrades = countMap["skipped"] ?? 0;

      const closedPositions = pnlAgg._count.id;
      const realizedPnl = pnlAgg._sum.realizedPnl ? Number(pnlAgg._sum.realizedPnl) : 0;

      // Win rate: profitable closed positions / total closed positions
      let winRate: number | null = null;
      if (closedPositions > 0) {
        const winningCount = await prisma.position.count({
          where: {
            subscriberId: request.subscriberId,
            status: "closed",
            realizedPnl: { gt: 0 },
          },
        });
        winRate = winningCount / closedPositions;
      }

      await reply.send({
        totalTrades,
        filledTrades,
        failedTrades,
        skippedTrades,
        realizedPnl,
        winRate,
      });
    },
  );

  // GET /api/pnl-history
  //
  // Returns up to N days of daily PnL snapshots (written by the engine's
  // close-position path). The dashboard uses this for the "today's PnL"
  // widget and the sparkline; missing days collapse to 0 client-side.
  app.get(
    "/api/pnl-history",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const qr = PnlHistoryQuery.safeParse(request.query);
      if (!qr.success) {
        await reply.status(400).send({ error: "Invalid query params" });
        return;
      }
      const { days } = qr.data;

      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - days + 1);

      const snapshots = await prisma.pnlSnapshot.findMany({
        where: { subscriberId: request.subscriberId, date: { gte: since } },
        orderBy: { date: "asc" },
      });

      await reply.send(
        snapshots.map((s: PnlSnapshot) => ({
          date: s.date.toISOString(),
          realizedPnl: Number(s.realizedPnl),
          totalTrades: s.totalTrades,
          winningTrades: s.winningTrades,
        })),
      );
    },
  );
}
