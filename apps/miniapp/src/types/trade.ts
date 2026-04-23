/**
 * Open position for UI + future API mapping.
 * Example API: `{ pair, side, leverage, size_usdt, entry_price, mark_price, pnl_usdt, pnl_pct }`
 */
export type PositionStatus = "open" | "closed" | "order";

export type OpenTradePosition = {
  id?: string;
  pair: string;
  side: "LONG" | "SHORT";
  leverage: number;
  /** Position size / margin context in USDT */
  sizeUsdt: number;
  entryPrice: number;
  currentPrice: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt?: string;
  /** Exchange/UI state — maps to badges on list cards */
  status?: PositionStatus;
  /** Copy-trade source — future API */
  sourceLabel?: string;
};
