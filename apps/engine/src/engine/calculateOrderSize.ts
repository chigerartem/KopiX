/**
 * Order size calculation.
 *
 * Two modes (from architecture §10.2):
 *
 * FIXED:      usdtSize = subscriber.fixedAmount
 * PERCENTAGE: usdtSize = balance.available * (percentage / 100)
 *
 * Then:
 *   contractSize = floor(usdtSize / contractValue)
 *   if contractSize < minOrderSize → skip
 *   if maxPositionUsdt set and usdtSize > cap → clamp
 */

import { CopyMode } from "@kopix/shared";
import { getBalance } from "@kopix/exchange";
import type { Credentials } from "@kopix/exchange";
import { logger } from "../logger.js";

/** Approximate USDT value of one contract per symbol.
 *  Real implementations would fetch this from the exchange;
 *  for Phase 2 we use a conservative static default of $1 per contract.
 *  The engine can be extended later to cache live contract sizes. */
const DEFAULT_CONTRACT_VALUE_USDT = 1;
const DEFAULT_MIN_ORDER_CONTRACTS = 1;

export interface SubscriberSizingConfig {
  subscriberId: string;
  copyMode: CopyMode;
  fixedAmount: number | null;
  percentage: number | null;
  maxPositionUsdt: number | null;
}

export type SizeResult =
  | { skip: false; contractSize: number; estimatedUsdt: number }
  | { skip: true; reason: string };

export async function calculateOrderSize(
  config: SubscriberSizingConfig,
  credentials: Credentials,
): Promise<SizeResult> {
  let usdtSize: number;

  if (config.copyMode === CopyMode.Fixed) {
    if (!config.fixedAmount || config.fixedAmount <= 0) {
      return { skip: true, reason: "fixed_amount_not_set" };
    }
    usdtSize = config.fixedAmount;
  } else {
    // PERCENTAGE mode
    if (!config.percentage || config.percentage <= 0) {
      return { skip: true, reason: "percentage_not_set" };
    }

    let balance: Awaited<ReturnType<typeof getBalance>>;
    try {
      balance = await getBalance(credentials);
    } catch (err: unknown) {
      logger.warn(
        { event: "size_calc.balance_fetch_failed", subscriberId: config.subscriberId, err },
        "Cannot fetch balance — skipping",
      );
      return { skip: true, reason: "balance_fetch_failed" };
    }

    if (balance.available <= 0) {
      return { skip: true, reason: "insufficient_balance" };
    }

    usdtSize = balance.available * (config.percentage / 100);
  }

  // Apply max position cap
  if (config.maxPositionUsdt && usdtSize > config.maxPositionUsdt) {
    usdtSize = config.maxPositionUsdt;
  }

  const contractSize = Math.floor(usdtSize / DEFAULT_CONTRACT_VALUE_USDT);

  if (contractSize < DEFAULT_MIN_ORDER_CONTRACTS) {
    return { skip: true, reason: "below_minimum_order_size" };
  }

  return { skip: false, contractSize, estimatedUsdt: usdtSize };
}
