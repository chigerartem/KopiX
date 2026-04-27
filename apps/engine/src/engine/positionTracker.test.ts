import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignalType, OrderSide } from "@kopix/shared";

const txMethods = vi.hoisted(() => ({
  positionFindFirst: vi.fn(),
  positionFindMany: vi.fn(),
  positionCreate: vi.fn(),
  positionUpdate: vi.fn(),
}));

vi.mock("@kopix/db", () => ({
  createPrismaClient: () => ({
    position: {
      findFirst: txMethods.positionFindFirst,
      findMany: txMethods.positionFindMany,
      create: txMethods.positionCreate,
      update: txMethods.positionUpdate,
    },
  }),
}));

import {
  openPositionTx,
  closePositionTx,
  increasePositionTx,
  decreasePositionTx,
} from "./positionTracker.js";

const tx = {
  position: {
    findFirst: txMethods.positionFindFirst,
    findMany: txMethods.positionFindMany,
    create: txMethods.positionCreate,
    update: txMethods.positionUpdate,
  },
} as never;

const baseSignal = {
  id: "sig-1",
  symbol: "BTC/USDT:USDT",
  side: OrderSide.Buy,
  signalType: SignalType.OpenLong,
  masterPrice: 50000,
  masterSize: 1,
  masterPositionId: "p-1",
  timestamp: 1700000000000,
};

describe("positionTracker", () => {
  beforeEach(() => {
    Object.values(txMethods).forEach((fn) => fn.mockReset());
  });

  describe("openPositionTx", () => {
    it("creates a long position on OpenLong", async () => {
      await openPositionTx(tx, baseSignal, "sub-1", 50000, 10);
      expect(txMethods.positionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriberId: "sub-1",
            side: "long",
            entryPrice: 50000,
            size: 10,
            status: "open",
          }),
        }),
      );
    });

    it("does nothing on a non-open signal", async () => {
      const closeSig = { ...baseSignal, signalType: SignalType.CloseLong };
      await openPositionTx(tx, closeSig, "sub-1", 50000, 10);
      expect(txMethods.positionCreate).not.toHaveBeenCalled();
    });
  });

  describe("closePositionTx", () => {
    it("closes the matching open position with realised pnl", async () => {
      txMethods.positionFindMany.mockResolvedValueOnce([
        { id: "pos-1", entryPrice: 50000, size: 10, realizedPnl: null, side: "long" },
      ]);
      const closeSig = {
        ...baseSignal,
        signalType: SignalType.CloseLong,
        side: OrderSide.Sell,
      };
      await closePositionTx(tx, closeSig, "sub-1", 51000);
      expect(txMethods.positionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pos-1" },
          data: expect.objectContaining({
            status: "closed",
            exitPrice: 51000,
            realizedPnl: (51000 - 50000) * 10,
          }),
        }),
      );
    });

    it("warns and does nothing if no matching open position exists", async () => {
      txMethods.positionFindMany.mockResolvedValueOnce([]);
      const closeSig = { ...baseSignal, signalType: SignalType.CloseLong };
      await closePositionTx(tx, closeSig, "sub-1", 51000);
      expect(txMethods.positionUpdate).not.toHaveBeenCalled();
    });
  });

  describe("increasePositionTx", () => {
    it("cost-averages entry price into the existing position", async () => {
      txMethods.positionFindFirst.mockResolvedValueOnce({
        id: "pos-1",
        entryPrice: 50000,
        size: 10,
      });
      const incSig = { ...baseSignal, signalType: SignalType.IncreaseLong };
      await increasePositionTx(tx, incSig, "sub-1", 60000, 10);
      expect(txMethods.positionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pos-1" },
          data: expect.objectContaining({
            size: 20,
            // Weighted avg: (50000*10 + 60000*10)/20 = 55000
            entryPrice: 55000,
          }),
        }),
      );
    });

    it("opens a fresh position if none matches", async () => {
      txMethods.positionFindFirst.mockResolvedValueOnce(null);
      const incSig = { ...baseSignal, signalType: SignalType.IncreaseLong };
      await increasePositionTx(tx, incSig, "sub-1", 60000, 10);
      expect(txMethods.positionCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("decreasePositionTx", () => {
    it("partially reduces a position and books realised PnL on the reduced portion", async () => {
      txMethods.positionFindMany.mockResolvedValueOnce([
        { id: "pos-1", entryPrice: 50000, size: 10, realizedPnl: null, side: "long" },
      ]);
      const decSig = { ...baseSignal, signalType: SignalType.DecreaseLong };
      await decreasePositionTx(tx, decSig, "sub-1", 51000, 4);
      // 4 of 10 reduced: pnl = (51000-50000)*4 = 4000, size left = 6
      expect(txMethods.positionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pos-1" },
          data: expect.objectContaining({ size: 6, realizedPnl: 4000 }),
        }),
      );
    });

    it("fully closes a position when reduce >= size and continues to next FIFO position", async () => {
      txMethods.positionFindMany.mockResolvedValueOnce([
        { id: "pos-1", entryPrice: 50000, size: 5, realizedPnl: null, side: "long" },
        { id: "pos-2", entryPrice: 51000, size: 10, realizedPnl: null, side: "long" },
      ]);
      const decSig = { ...baseSignal, signalType: SignalType.DecreaseLong };
      await decreasePositionTx(tx, decSig, "sub-1", 52000, 8);
      // pos-1 closed entirely (5 reduced), pos-2 reduced by 3, leaving 7
      const calls = txMethods.positionUpdate.mock.calls;
      expect(calls[0]?.[0]?.where?.id).toBe("pos-1");
      expect(calls[0]?.[0]?.data?.status).toBe("closed");
      expect(calls[1]?.[0]?.where?.id).toBe("pos-2");
      expect(calls[1]?.[0]?.data?.size).toBe(7);
    });

    it("logs a warning when DECREASE size exceeds total open size", async () => {
      txMethods.positionFindMany.mockResolvedValueOnce([
        { id: "pos-1", entryPrice: 50000, size: 5, realizedPnl: null, side: "long" },
      ]);
      const decSig = { ...baseSignal, signalType: SignalType.DecreaseLong };
      // Should not throw — leftover is logged and ignored.
      await expect(decreasePositionTx(tx, decSig, "sub-1", 52000, 100)).resolves.not.toThrow();
    });
  });
});
