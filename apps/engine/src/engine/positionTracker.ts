/**
 * Position tracker.
 *
 * Maintains open/closed position records per subscriber.
 *
 * On OPEN signals:  create a new Position row (status = open)
 * On CLOSE signals: find matching open position by (subscriberId, openSignalId)
 *                   calculate realized P&L, mark closed
 *
 * Position matching uses open_signal_id (architecture §10.4):
 *   When the engine receives a CLOSE signal it looks for all open positions
 *   where the symbol and side match, then closes them.
 */

import { SignalType } from "@kopix/shared";
import type { TradeSignal } from "@kopix/shared";
import { createPrismaClient } from "@kopix/db";
import { logger } from "../logger.js";

const prisma = createPrismaClient();

function isOpenSignal(signalType: SignalType): boolean {
  return signalType === SignalType.OpenLong || signalType === SignalType.OpenShort;
}

function isCloseSignal(signalType: SignalType): boolean {
  return signalType === SignalType.CloseLong || signalType === SignalType.CloseShort;
}

function positionSideFromSignal(signalType: SignalType): "long" | "short" {
  return signalType === SignalType.OpenLong ||
    signalType === SignalType.CloseLong ||
    signalType === SignalType.IncreaseLong ||
    signalType === SignalType.DecreaseLong
    ? "long"
    : "short";
}

/**
 * Called after a successful OPEN order execution.
 * Creates an open Position row linked to this signal.
 */
export async function openPosition(
  signal: TradeSignal,
  subscriberId: string,
  executedPrice: number,
  executedSize: number,
): Promise<void> {
  if (!isOpenSignal(signal.signalType)) return;

  await prisma.position.create({
    data: {
      subscriberId,
      openSignalId: signal.id,
      symbol: signal.symbol,
      side: positionSideFromSignal(signal.signalType),
      entryPrice: executedPrice,
      size: executedSize,
      status: "open",
      openedAt: new Date(signal.timestamp),
    },
  });

  logger.info(
    { event: "position.opened", subscriberId, symbol: signal.symbol, signalId: signal.id },
    "Position opened",
  );
}

/**
 * Called after a successful CLOSE order execution.
 * Finds matching open positions and marks them closed with P&L.
 */
export async function closePosition(
  signal: TradeSignal,
  subscriberId: string,
  executedPrice: number,
): Promise<void> {
  if (!isCloseSignal(signal.signalType)) return;

  const side = positionSideFromSignal(signal.signalType);

  // Find open positions for this subscriber/symbol/side
  const openPositions = await prisma.position.findMany({
    where: {
      subscriberId,
      symbol: signal.symbol,
      side,
      status: "open",
    },
    orderBy: { openedAt: "asc" },
  });

  if (openPositions.length === 0) {
    logger.warn(
      { event: "position.close_no_match", subscriberId, symbol: signal.symbol, side },
      "No open position found to close",
    );
    return;
  }

  for (const position of openPositions) {
    const entryPrice = Number(position.entryPrice);
    const size = Number(position.size);

    // P&L = (exitPrice - entryPrice) × size  for LONG
    //       (entryPrice - exitPrice) × size  for SHORT
    const rawPnl =
      side === "long"
        ? (executedPrice - entryPrice) * size
        : (entryPrice - executedPrice) * size;

    await prisma.position.update({
      where: { id: position.id },
      data: {
        exitPrice: executedPrice,
        realizedPnl: rawPnl,
        status: "closed",
        closedAt: new Date(),
      },
    });

    logger.info(
      {
        event: "position.closed",
        positionId: position.id,
        subscriberId,
        symbol: signal.symbol,
        realizedPnl: rawPnl,
      },
      "Position closed",
    );
  }
}
