import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignalType, OrderSide, CopyMode } from "@kopix/shared";

const txOps = vi.hoisted(() => ({
  copiedTradeFindUnique: vi.fn(),
  copiedTradeUpsert: vi.fn(),
  copiedTradeUpdate: vi.fn(),
  subscriberUpdate: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  $transaction: vi.fn(),
}));

const calculateOrderSizeMock = vi.hoisted(() => vi.fn());
const placeMarketOrderMock = vi.hoisted(() => vi.fn());
const decryptMock = vi.hoisted(() => vi.fn((v: string) => `decrypted-${v}`));
const openPositionTxMock = vi.hoisted(() => vi.fn());
const closePositionTxMock = vi.hoisted(() => vi.fn());
const increasePositionTxMock = vi.hoisted(() => vi.fn());
const decreasePositionTxMock = vi.hoisted(() => vi.fn());
const redisPublishMock = vi.hoisted(() => vi.fn());

// $transaction(callback) and $transaction([ops]) — handle both signatures.
txOps.$transaction.mockImplementation(async (arg: unknown) => {
  if (typeof arg === "function") {
    return (arg as (tx: unknown) => Promise<unknown>)({
      copiedTrade: {
        update: txOps.copiedTradeUpdate,
        upsert: txOps.copiedTradeUpsert,
        findUnique: txOps.copiedTradeFindUnique,
      },
    });
  }
  return arg;
});

vi.mock("@kopix/db", () => ({
  createPrismaClient: () => ({
    copiedTrade: {
      findUnique: txOps.copiedTradeFindUnique,
      upsert: txOps.copiedTradeUpsert,
      update: txOps.copiedTradeUpdate,
    },
    subscriber: { update: txOps.subscriberUpdate },
    subscription: { findFirst: txOps.subscriptionFindFirst },
    $transaction: txOps.$transaction,
  }),
}));

vi.mock("@kopix/exchange", () => ({
  placeMarketOrder: placeMarketOrderMock,
}));

vi.mock("@kopix/crypto", () => ({
  decrypt: decryptMock,
}));

vi.mock("./calculateOrderSize.js", () => ({
  calculateOrderSize: calculateOrderSizeMock,
}));

vi.mock("./positionTracker.js", () => ({
  openPositionTx: openPositionTxMock,
  closePositionTx: closePositionTxMock,
  increasePositionTx: increasePositionTxMock,
  decreasePositionTx: decreasePositionTxMock,
}));

vi.mock("../redis/redisClient.js", () => ({
  getRedisClient: () => ({ publish: redisPublishMock }),
}));

import { executeForSubscriber } from "./subscriberExecutor.js";

const baseSignal = {
  id: "sig-1",
  symbol: "BTC/USDT:USDT",
  side: OrderSide.Buy,
  signalType: SignalType.OpenLong,
  masterPrice: 50000,
  masterSize: 0.1,
  masterPositionId: "p-1",
  timestamp: 1700000000000,
};

const baseSubscriber = {
  id: "sub-1",
  apiKeyEncrypted: "enc-key",
  apiSecretEncrypted: "enc-secret",
  copyMode: CopyMode.Fixed,
  fixedAmount: 100,
  percentage: null,
  maxPositionUsdt: null,
};

describe("subscriberExecutor", () => {
  beforeEach(() => {
    process.env["APP_ENCRYPTION_KEY"] = "x".repeat(44); // any non-empty
    Object.values(txOps).forEach((fn) => fn.mockReset?.());
    txOps.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => Promise<unknown>)({
          copiedTrade: {
            update: txOps.copiedTradeUpdate,
            upsert: txOps.copiedTradeUpsert,
            findUnique: txOps.copiedTradeFindUnique,
          },
        });
      }
      return arg;
    });
    calculateOrderSizeMock.mockReset();
    placeMarketOrderMock.mockReset();
    decryptMock.mockReset().mockImplementation((v: string) => `decrypted-${v}`);
    openPositionTxMock.mockReset();
    closePositionTxMock.mockReset();
    increasePositionTxMock.mockReset();
    decreasePositionTxMock.mockReset();
    redisPublishMock.mockReset();

    txOps.subscriptionFindFirst.mockResolvedValue({ id: "active-sub" });
    txOps.copiedTradeUpsert.mockResolvedValue({ id: "trade-1" });
    txOps.copiedTradeUpdate.mockResolvedValue({});
    txOps.subscriberUpdate.mockResolvedValue({});
    calculateOrderSizeMock.mockResolvedValue({
      skip: false,
      contractSize: 100,
      estimatedUsdt: 100,
    });
    placeMarketOrderMock.mockResolvedValue({
      orderId: "ex-1",
      executedAmount: 100,
      executedPrice: 50001,
      symbol: baseSignal.symbol,
      side: "buy",
      amount: 100,
      status: "filled",
      rawResponse: {},
    });
    redisPublishMock.mockResolvedValue(1);
  });

  it("idempotent skip when trade already filled with exchange order id", async () => {
    txOps.copiedTradeFindUnique.mockResolvedValueOnce({
      status: "filled",
      exchangeOrderId: "ex-existing",
    });

    await executeForSubscriber(baseSignal, baseSubscriber as never);

    expect(placeMarketOrderMock).not.toHaveBeenCalled();
    expect(txOps.copiedTradeUpsert).not.toHaveBeenCalled();
  });

  it("idempotent skip when trade already partial — does not retry", async () => {
    txOps.copiedTradeFindUnique.mockResolvedValueOnce({
      status: "partial",
      exchangeOrderId: "ex-partial",
    });

    await executeForSubscriber(baseSignal, baseSubscriber as never);

    expect(placeMarketOrderMock).not.toHaveBeenCalled();
  });

  it("skips and records when subscription has expired between selection and execution", async () => {
    txOps.copiedTradeFindUnique.mockResolvedValueOnce(null);
    txOps.subscriptionFindFirst.mockResolvedValueOnce(null); // no active sub now

    await executeForSubscriber(baseSignal, baseSubscriber as never);

    expect(placeMarketOrderMock).not.toHaveBeenCalled();
    // recordSkipped(reason="subscription_expired")
    expect(txOps.copiedTradeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "skipped", failureReason: "subscription_expired" }),
      }),
    );
  });

  it("classifies smaller execution than ordered as partial fill", async () => {
    txOps.copiedTradeFindUnique.mockResolvedValueOnce(null);
    placeMarketOrderMock.mockResolvedValueOnce({
      orderId: "ex-partial",
      executedAmount: 60, // < 100 ordered
      executedPrice: 50001,
      symbol: baseSignal.symbol,
      side: "buy",
      amount: 100,
      status: "partial",
      rawResponse: {},
    });

    await executeForSubscriber(baseSignal, baseSubscriber as never);

    // Inside the transaction, the trade should be marked partial, not filled.
    const updateCall = txOps.copiedTradeUpdate.mock.calls.find(
      (c) => c[0]?.data?.status === "partial",
    );
    expect(updateCall).toBeDefined();
  });

  it("clears credentials and publishes account event on auth-failure error", async () => {
    txOps.copiedTradeFindUnique.mockResolvedValueOnce(null);
    placeMarketOrderMock.mockRejectedValue(new Error("AuthenticationError: invalid key"));

    await executeForSubscriber(baseSignal, baseSubscriber as never);

    // Subscriber must have keys cleared.
    const subUpdateCall = txOps.$transaction.mock.calls.find((c) => Array.isArray(c[0]));
    expect(subUpdateCall).toBeDefined();
    // Notification publish on account:* channel.
    expect(redisPublishMock).toHaveBeenCalledWith(
      "account:sub-1",
      expect.stringContaining("key_revoked"),
    );
  });

  it("opens a position in the same transaction on a successful OpenLong fill", async () => {
    txOps.copiedTradeFindUnique.mockResolvedValueOnce(null);

    await executeForSubscriber(baseSignal, baseSubscriber as never);

    expect(openPositionTxMock).toHaveBeenCalledTimes(1);
    expect(closePositionTxMock).not.toHaveBeenCalled();
  });

  it("calls closePositionTx on a CloseLong fill", async () => {
    txOps.copiedTradeFindUnique.mockResolvedValueOnce(null);

    await executeForSubscriber(
      { ...baseSignal, signalType: SignalType.CloseLong, side: OrderSide.Sell },
      baseSubscriber as never,
    );

    expect(closePositionTxMock).toHaveBeenCalledTimes(1);
    expect(openPositionTxMock).not.toHaveBeenCalled();
  });
});
