/**
 * Signal normalizer.
 *
 * Converts raw BingX ORDER_TRADE_UPDATE WebSocket events into the
 * canonical TradeSignal shape defined in @kopix/shared.
 *
 * BingX hedge-mode event structure (simplified):
 * {
 *   e: "ORDER_TRADE_UPDATE",
 *   o: {
 *     s:  string,   // symbol, e.g. "BTC-USDT"  → normalised to "BTC/USDT:USDT"
 *     S:  "BUY"|"SELL",
 *     ps: "LONG"|"SHORT",   // position side (hedge mode)
 *     X:  "FILLED"|"PARTIALLY_FILLED"|...,
 *     ot: "MARKET"|"LIMIT"|...,
 *     ap: string,  // average price
 *     q:  string,  // original quantity
 *     l:  string,  // last filled quantity
 *     T:  number,  // trade time (ms)
 *     i:  string,  // order id
 *     c:  string,  // client order id (position id proxy)
 *   }
 * }
 */

import { SignalType, OrderSide } from "@kopix/shared";
import type { TradeSignal } from "@kopix/shared";
import type { BingXRawEvent } from "../watcher/masterWatcher.js";
import { logger } from "../logger.js";
import { randomUUID } from "node:crypto";

interface BingXOrder {
  s?: string;
  S?: string;
  ps?: string;
  X?: string;
  ot?: string;
  ap?: string;
  q?: string;
  l?: string;
  T?: number;
  i?: string;
  c?: string;
  rp?: string; // realized profit
}

interface BingXTradeUpdateEvent extends Record<string, unknown> {
  e: string;
  o: BingXOrder;
}

function isBingXTradeUpdate(ev: BingXRawEvent): ev is BingXTradeUpdateEvent {
  return (
    typeof ev["e"] === "string" &&
    ev["e"] === "ORDER_TRADE_UPDATE" &&
    ev["o"] !== null &&
    typeof ev["o"] === "object"
  );
}

/** BingX uses "BTC-USDT" format; ccxt expects "BTC/USDT:USDT" for perpetuals */
function normaliseSymbol(raw: string): string {
  // "BTC-USDT" → "BTC/USDT:USDT"
  const parts = raw.split("-");
  if (parts.length === 2) {
    const [base, quote] = parts;
    return `${base}/${quote}:${quote}`;
  }
  return raw; // already normalised or unknown format
}

function resolveSignalType(side: string, positionSide: string): SignalType | null {
  const s = side.toUpperCase();
  const ps = positionSide.toUpperCase();

  // Hedge mode: BUY LONG = open long, SELL LONG = close/decrease long
  //             SELL SHORT = open short, BUY SHORT = close/decrease short
  if (s === "BUY" && ps === "LONG") return SignalType.OpenLong;
  if (s === "SELL" && ps === "LONG") return SignalType.CloseLong;
  if (s === "SELL" && ps === "SHORT") return SignalType.OpenShort;
  if (s === "BUY" && ps === "SHORT") return SignalType.CloseShort;
  return null;
}

function resolveOrderSide(bingxSide: string): OrderSide {
  return bingxSide.toUpperCase() === "BUY" ? OrderSide.Buy : OrderSide.Sell;
}

/**
 * Attempt to normalise a raw BingX WebSocket event into a TradeSignal.
 * Returns null if the event is not a relevant ORDER_TRADE_UPDATE.
 */
export function normalizeSignal(raw: BingXRawEvent): TradeSignal | null {
  if (!isBingXTradeUpdate(raw)) return null;

  const o = raw.o;

  // Only process fully filled orders to avoid partial noise
  if (o.X !== "FILLED") return null;

  const side = o.S ?? "";
  const positionSide = o.ps ?? "";
  const signalType = resolveSignalType(side, positionSide);

  if (!signalType) {
    logger.debug({ event: "normalizer.unknown_side", side, positionSide }, "Unrecognised side combo");
    return null;
  }

  const symbol = normaliseSymbol(o.s ?? "");
  const masterPrice = parseFloat(o.ap ?? "0");
  const masterSize = parseFloat(o.l ?? o.q ?? "0");

  if (!symbol || masterPrice <= 0 || masterSize <= 0) {
    logger.warn({ event: "normalizer.invalid_values", o }, "Skipping signal with zero/missing values");
    return null;
  }

  const signal: TradeSignal = {
    id: randomUUID(),
    symbol,
    side: resolveOrderSide(side),
    signalType,
    masterPrice,
    masterSize,
    masterPositionId: o.c ?? o.i ?? "",
    timestamp: o.T ?? Date.now(),
  };

  logger.info({ event: "signal.normalised", signal }, "Trade signal normalised");
  return signal;
}
