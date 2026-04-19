/**
 * Failure-injection integration test for the signal consumer.
 *
 * Requires Redis at $REDIS_URL (default redis://localhost:6379).
 * Verifies at-least-once guarantee: if a processor throws, the entry
 * remains in PEL and is reclaimed + reprocessed on next consumer start.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { startSignalConsumer } from "./signalConsumer.js";
import { publishSignal, TRADE_SIGNALS_STREAM } from "../redis/streamPublisher.js";
import { getRedisClient } from "../redis/redisClient.js";
import { OrderSide, SignalType } from "@kopix/shared";
import type { TradeSignal } from "@kopix/shared";

const TEST_STREAM = TRADE_SIGNALS_STREAM;
const CONSUMER_GROUP = "engine-group";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeSignal(overrides: Partial<TradeSignal> = {}): TradeSignal {
  return {
    id: randomUUID(),
    symbol: "BTC/USDT:USDT",
    side: OrderSide.Buy,
    signalType: SignalType.OpenLong,
    masterPrice: 50000,
    masterSize: 0.1,
    masterPositionId: "m-1",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("signalConsumer: at-least-once delivery under failure injection", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = getRedisClient();
  });

  beforeEach(async () => {
    // Clear stream + consumer group before each test for isolation
    try {
      await redis.xgroup("DESTROY", TEST_STREAM, CONSUMER_GROUP);
    } catch {
      /* group may not exist yet */
    }
    await redis.del(TEST_STREAM);
  });

  afterAll(async () => {
    await redis.del(TEST_STREAM);
    await redis.quit();
  });

  it("redelivers a signal when the processor throws, then acks on retry", async () => {
    const signal = makeSignal();
    await publishSignal(signal);

    // First pass — processor fails
    let attempts = 0;
    const failProcessor = async (): Promise<void> => {
      attempts++;
      throw new Error("simulated downstream failure");
    };
    const stop1 = await startSignalConsumer(failProcessor);
    await sleep(500);
    stop1();
    await sleep(100);

    expect(attempts).toBeGreaterThanOrEqual(1);

    // Entry must still be in the PEL (not ACKed)
    const pendingAfterFail = (await redis.xpending(TEST_STREAM, CONSUMER_GROUP)) as
      | [number, string | null, string | null, Array<[string, number]> | null]
      | null;
    expect(pendingAfterFail?.[0]).toBeGreaterThanOrEqual(1);

    // Second pass — processor succeeds; XAUTOCLAIM should reclaim PEL entry
    const received: TradeSignal[] = [];
    const okProcessor = async (s: TradeSignal): Promise<void> => {
      received.push(s);
    };
    const stop2 = await startSignalConsumer(okProcessor);
    await sleep(500);
    stop2();
    await sleep(100);

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]?.id).toBe(signal.id);

    const pendingAfterOk = (await redis.xpending(TEST_STREAM, CONSUMER_GROUP)) as
      | [number, string | null, string | null, Array<[string, number]> | null]
      | null;
    expect(pendingAfterOk?.[0]).toBe(0);
  });

  it("processes live-streamed signals in order", async () => {
    const processed: string[] = [];
    const processor = async (s: TradeSignal): Promise<void> => {
      processed.push(s.id);
    };
    const stop = await startSignalConsumer(processor);

    const s1 = makeSignal();
    const s2 = makeSignal();
    const s3 = makeSignal();
    await publishSignal(s1);
    await publishSignal(s2);
    await publishSignal(s3);

    await sleep(700);
    stop();
    await sleep(100);

    expect(processed).toEqual([s1.id, s2.id, s3.id]);
  });
});
