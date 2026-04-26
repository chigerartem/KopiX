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
import { createPrismaClient, type Prisma } from "@kopix/db";
import { logger } from "../logger.js";

const prisma = createPrismaClient();

/**
 * A Prisma transaction client. Accept this in *Tx variants so the position
 * write commits atomically with the trade-record update that triggered it
 * (otherwise a crash between the two leaves an orphan filled trade and no
 * position, breaking P&L).
 */
export type Tx = Prisma.TransactionClient;

function isOpenSignal(signalType: SignalType): boolean {
  return signalType === SignalType.OpenLong || signalType === SignalType.OpenShort;
}

function isCloseSignal(signalType: SignalType): boolean {
  return signalType === SignalType.CloseLong || signalType === SignalType.CloseShort;
}

function isIncreaseSignal(signalType: SignalType): boolean {
  return signalType === SignalType.IncreaseLong || signalType === SignalType.IncreaseShort;
}

function isDecreaseSignal(signalType: SignalType): boolean {
  return signalType === SignalType.DecreaseLong || signalType === SignalType.DecreaseShort;
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
 *
 * Transaction-aware: pass a Prisma tx client so the position write commits
 * with the parent trade update.
 */
export async function openPositionTx(
  tx: Tx,
  signal: TradeSignal,
  subscriberId: string,
  executedPrice: number,
  executedSize: number,
): Promise<void> {
  if (!isOpenSignal(signal.signalType)) return;

  await tx.position.create({
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

/** Convenience wrapper that opens its own implicit transaction. */
export async function openPosition(
  signal: TradeSignal,
  subscriberId: string,
  executedPrice: number,
  executedSize: number,
): Promise<void> {
  await prisma.$transaction((tx) =>
    openPositionTx(tx, signal, subscriberId, executedPrice, executedSize),
  );
}

/**
 * Called after a successful CLOSE order execution.
 * Finds matching open positions and marks them closed with P&L.
 *
 * Transaction-aware variant: pass a tx client.
 */
export async function closePositionTx(
  tx: Tx,
  signal: TradeSignal,
  subscriberId: string,
  executedPrice: number,
): Promise<void> {
  if (!isCloseSignal(signal.signalType)) return;

  const side = positionSideFromSignal(signal.signalType);

  // Find open positions for this subscriber/symbol/side
  const openPositions = await tx.position.findMany({
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

    await tx.position.update({
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

/** Convenience wrapper that opens its own implicit transaction. */
export async function closePosition(
  signal: TradeSignal,
  subscriberId: string,
  executedPrice: number,
): Promise<void> {
  await prisma.$transaction((tx) => closePositionTx(tx, signal, subscriberId, executedPrice));
}

/**
 * Adds size to the oldest matching open position (cost-averaging the entry
 * price). Used when the master adds to an existing direction.
 *
 * If no matching open position exists, treat as an OPEN: create one. This
 * matches BingX semantics where INCREASE on no position effectively opens.
 */
export async function increasePositionTx(
  tx: Tx,
  signal: TradeSignal,
  subscriberId: string,
  executedPrice: number,
  executedSize: number,
): Promise<void> {
  if (!isIncreaseSignal(signal.signalType)) return;
  const side = positionSideFromSignal(signal.signalType);

  const existing = await tx.position.findFirst({
    where: { subscriberId, symbol: signal.symbol, side, status: "open" },
    orderBy: { openedAt: "asc" },
  });

  if (!existing) {
    // No position to add to → open a fresh one. This is a defensive fallback;
    // the engine should normally see OPEN before INCREASE.
    await tx.position.create({
      data: {
        subscriberId,
        openSignalId: signal.id,
        symbol: signal.symbol,
        side,
        entryPrice: executedPrice,
        size: executedSize,
        status: "open",
        openedAt: new Date(signal.timestamp),
      },
    });
    logger.info(
      { event: "position.increase_as_open", subscriberId, symbol: signal.symbol, signalId: signal.id },
      "INCREASE arrived with no matching position — opened new",
    );
    return;
  }

  const oldSize = Number(existing.size);
  const oldEntry = Number(existing.entryPrice);
  const newSize = oldSize + executedSize;
  // Weighted-average entry price across the existing and added portions.
  const newEntry = (oldEntry * oldSize + executedPrice * executedSize) / newSize;

  await tx.position.update({
    where: { id: existing.id },
    data: { size: newSize, entryPrice: newEntry },
  });

  logger.info(
    {
      event: "position.increased",
      positionId: existing.id,
      subscriberId,
      addedSize: executedSize,
      newSize,
      newEntry,
    },
    "Position increased",
  );
}

/**
 * Reduces size on the oldest matching open position. Realised P&L for the
 * reduced portion is booked immediately. If the reduction equals or exceeds
 * the full position size, the position is closed.
 *
 * Spread across multiple positions (FIFO) when one is too small.
 */
export async function decreasePositionTx(
  tx: Tx,
  signal: TradeSignal,
  subscriberId: string,
  executedPrice: number,
  executedSize: number,
): Promise<void> {
  if (!isDecreaseSignal(signal.signalType)) return;
  const side = positionSideFromSignal(signal.signalType);

  const openPositions = await tx.position.findMany({
    where: { subscriberId, symbol: signal.symbol, side, status: "open" },
    orderBy: { openedAt: "asc" },
  });

  if (openPositions.length === 0) {
    logger.warn(
      { event: "position.decrease_no_match", subscriberId, symbol: signal.symbol, side },
      "DECREASE with no matching open position — ignored",
    );
    return;
  }

  let remaining = executedSize;
  for (const position of openPositions) {
    if (remaining <= 0) break;

    const posSize = Number(position.size);
    const entryPrice = Number(position.entryPrice);
    const reduceBy = Math.min(remaining, posSize);

    const partialPnl =
      side === "long"
        ? (executedPrice - entryPrice) * reduceBy
        : (entryPrice - executedPrice) * reduceBy;

    if (reduceBy + 1e-8 >= posSize) {
      // Full close of this position
      await tx.position.update({
        where: { id: position.id },
        data: {
          status: "closed",
          exitPrice: executedPrice,
          realizedPnl: (Number(position.realizedPnl) || 0) + partialPnl,
          closedAt: new Date(),
        },
      });
    } else {
      // Partial reduction — keep position open with reduced size, accumulate realised PnL
      await tx.position.update({
        where: { id: position.id },
        data: {
          size: posSize - reduceBy,
          realizedPnl: (Number(position.realizedPnl) || 0) + partialPnl,
        },
      });
    }

    remaining -= reduceBy;
    logger.info(
      {
        event: "position.decreased",
        positionId: position.id,
        subscriberId,
        reducedBy: reduceBy,
        partialPnl,
        leftover: posSize - reduceBy,
      },
      "Position decreased",
    );
  }

  if (remaining > 1e-8) {
    logger.warn(
      {
        event: "position.decrease_overshoot",
        subscriberId,
        symbol: signal.symbol,
        side,
        unmatched: remaining,
      },
      "DECREASE size exceeded total open size — leftover ignored",
    );
  }
}
