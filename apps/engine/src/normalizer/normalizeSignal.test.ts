import { describe, it, expect } from "vitest";
import { SignalType, OrderSide } from "@kopix/shared";
import { normalizeSignal } from "./normalizeSignal.js";

function baseOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    e: "ORDER_TRADE_UPDATE",
    o: {
      s: "BTC-USDT",
      S: "BUY",
      ps: "LONG",
      X: "FILLED",
      ot: "MARKET",
      ap: "50000",
      q: "0.1",
      l: "0.1",
      T: 1_700_000_000_000,
      i: "order-1",
      c: "client-1",
      ...(overrides["o"] as Record<string, unknown> | undefined),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "o")),
  };
}

describe("normalizeSignal: BingX WebSocket → TradeSignal", () => {
  it("maps BUY/LONG FILLED to OpenLong", () => {
    const signal = normalizeSignal(baseOrder());
    expect(signal).not.toBeNull();
    expect(signal!.signalType).toBe(SignalType.OpenLong);
    expect(signal!.side).toBe(OrderSide.Buy);
    expect(signal!.symbol).toBe("BTC/USDT:USDT");
    expect(signal!.masterPrice).toBe(50000);
    expect(signal!.masterSize).toBe(0.1);
    expect(signal!.masterPositionId).toBe("client-1");
    expect(signal!.timestamp).toBe(1_700_000_000_000);
  });

  it("maps SELL/LONG FILLED to CloseLong", () => {
    const signal = normalizeSignal(baseOrder({ o: { S: "SELL", ps: "LONG" } }));
    expect(signal?.signalType).toBe(SignalType.CloseLong);
    expect(signal?.side).toBe(OrderSide.Sell);
  });

  it("maps SELL/SHORT FILLED to OpenShort", () => {
    const signal = normalizeSignal(baseOrder({ o: { S: "SELL", ps: "SHORT" } }));
    expect(signal?.signalType).toBe(SignalType.OpenShort);
    expect(signal?.side).toBe(OrderSide.Sell);
  });

  it("maps BUY/SHORT FILLED to CloseShort", () => {
    const signal = normalizeSignal(baseOrder({ o: { S: "BUY", ps: "SHORT" } }));
    expect(signal?.signalType).toBe(SignalType.CloseShort);
    expect(signal?.side).toBe(OrderSide.Buy);
  });

  it("returns null for PARTIALLY_FILLED orders", () => {
    expect(normalizeSignal(baseOrder({ o: { X: "PARTIALLY_FILLED" } }))).toBeNull();
  });

  it("returns null for non ORDER_TRADE_UPDATE events", () => {
    expect(normalizeSignal({ e: "ACCOUNT_UPDATE", o: {} })).toBeNull();
  });

  it("returns null for unknown side/positionSide combinations", () => {
    expect(normalizeSignal(baseOrder({ o: { S: "BUY", ps: "UNKNOWN" } }))).toBeNull();
  });

  it("returns null when price or size is zero", () => {
    expect(normalizeSignal(baseOrder({ o: { ap: "0" } }))).toBeNull();
    expect(normalizeSignal(baseOrder({ o: { l: "0", q: "0" } }))).toBeNull();
  });

  it("falls back from last-filled (l) to original quantity (q)", () => {
    const signal = normalizeSignal(baseOrder({ o: { l: undefined, q: "0.5" } }));
    expect(signal?.masterSize).toBe(0.5);
  });

  it("falls back from client-order-id (c) to order-id (i) for positionId", () => {
    const signal = normalizeSignal(baseOrder({ o: { c: undefined, i: "order-fallback" } }));
    expect(signal?.masterPositionId).toBe("order-fallback");
  });

  it("generates a unique uuid per signal", () => {
    const s1 = normalizeSignal(baseOrder());
    const s2 = normalizeSignal(baseOrder());
    expect(s1?.id).toBeDefined();
    expect(s1?.id).not.toBe(s2?.id);
  });
});
