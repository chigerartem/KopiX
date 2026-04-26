import { describe, it, expect, vi, beforeEach } from "vitest";
import { CopyMode } from "@kopix/shared";

const getBalanceMock = vi.hoisted(() => vi.fn());

// calculateOrderSize now goes through balanceCache → getBalance. Mock the
// cache wrapper directly so tests stay independent of Redis.
vi.mock("../cache/balanceCache.js", () => ({
  getCachedBalance: getBalanceMock,
}));

import { calculateOrderSize } from "./calculateOrderSize.js";

const creds = { apiKey: "k", apiSecret: "s" };

describe("calculateOrderSize", () => {
  beforeEach(() => {
    getBalanceMock.mockReset();
  });

  describe("FIXED mode", () => {
    it("returns the fixed contract size", async () => {
      const res = await calculateOrderSize(
        {
          subscriberId: "sub-1",
          copyMode: CopyMode.Fixed,
          fixedAmount: 50,
          percentage: null,
          maxPositionUsdt: null,
        },
        creds,
      );
      expect(res).toEqual({ skip: false, contractSize: 50, estimatedUsdt: 50 });
      expect(getBalanceMock).not.toHaveBeenCalled();
    });

    it("skips when fixedAmount is missing or zero", async () => {
      const r1 = await calculateOrderSize(
        { subscriberId: "s", copyMode: CopyMode.Fixed, fixedAmount: null, percentage: null, maxPositionUsdt: null },
        creds,
      );
      expect(r1).toEqual({ skip: true, reason: "fixed_amount_not_set" });

      const r2 = await calculateOrderSize(
        { subscriberId: "s", copyMode: CopyMode.Fixed, fixedAmount: 0, percentage: null, maxPositionUsdt: null },
        creds,
      );
      expect(r2).toEqual({ skip: true, reason: "fixed_amount_not_set" });
    });

    it("skips when fixedAmount produces less than 1 contract", async () => {
      const res = await calculateOrderSize(
        {
          subscriberId: "s",
          copyMode: CopyMode.Fixed,
          fixedAmount: 0.5,
          percentage: null,
          maxPositionUsdt: null,
        },
        creds,
      );
      expect(res).toEqual({ skip: true, reason: "below_minimum_order_size" });
    });
  });

  describe("PERCENTAGE mode", () => {
    it("sizes to the configured percent of available balance", async () => {
      getBalanceMock.mockResolvedValueOnce({ available: 1000, total: 1000 });
      const res = await calculateOrderSize(
        {
          subscriberId: "s",
          copyMode: CopyMode.Percentage,
          fixedAmount: null,
          percentage: 10,
          maxPositionUsdt: null,
        },
        creds,
      );
      expect(res).toEqual({ skip: false, contractSize: 100, estimatedUsdt: 100 });
    });

    it("skips when percentage is missing or zero", async () => {
      const res = await calculateOrderSize(
        {
          subscriberId: "s",
          copyMode: CopyMode.Percentage,
          fixedAmount: null,
          percentage: null,
          maxPositionUsdt: null,
        },
        creds,
      );
      expect(res).toEqual({ skip: true, reason: "percentage_not_set" });
    });

    it("skips when balance fetch throws (connectivity/auth problems)", async () => {
      getBalanceMock.mockRejectedValueOnce(new Error("network down"));
      const res = await calculateOrderSize(
        {
          subscriberId: "s",
          copyMode: CopyMode.Percentage,
          fixedAmount: null,
          percentage: 10,
          maxPositionUsdt: null,
        },
        creds,
      );
      expect(res).toEqual({ skip: true, reason: "balance_fetch_failed" });
    });

    it("skips when available balance is zero", async () => {
      getBalanceMock.mockResolvedValueOnce({ available: 0, total: 0 });
      const res = await calculateOrderSize(
        {
          subscriberId: "s",
          copyMode: CopyMode.Percentage,
          fixedAmount: null,
          percentage: 10,
          maxPositionUsdt: null,
        },
        creds,
      );
      expect(res).toEqual({ skip: true, reason: "insufficient_balance" });
    });
  });

  describe("maxPositionUsdt cap", () => {
    it("clamps fixed mode at the cap", async () => {
      const res = await calculateOrderSize(
        {
          subscriberId: "s",
          copyMode: CopyMode.Fixed,
          fixedAmount: 500,
          percentage: null,
          maxPositionUsdt: 100,
        },
        creds,
      );
      expect(res).toEqual({ skip: false, contractSize: 100, estimatedUsdt: 100 });
    });

    it("clamps percentage mode at the cap", async () => {
      getBalanceMock.mockResolvedValueOnce({ available: 10_000, total: 10_000 });
      const res = await calculateOrderSize(
        {
          subscriberId: "s",
          copyMode: CopyMode.Percentage,
          fixedAmount: null,
          percentage: 50,
          maxPositionUsdt: 200,
        },
        creds,
      );
      expect(res).toEqual({ skip: false, contractSize: 200, estimatedUsdt: 200 });
    });

    it("does not clamp when size is below cap", async () => {
      const res = await calculateOrderSize(
        {
          subscriberId: "s",
          copyMode: CopyMode.Fixed,
          fixedAmount: 50,
          percentage: null,
          maxPositionUsdt: 1000,
        },
        creds,
      );
      expect(res).toEqual({ skip: false, contractSize: 50, estimatedUsdt: 50 });
    });
  });
});
