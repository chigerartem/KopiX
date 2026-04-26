import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("@kopix/db", () => ({
  createPrismaClient: () => prismaMock,
}));

import { runExpiry } from "./expiry.js";

describe("expiry job", () => {
  beforeEach(() => {
    tx.$executeRaw.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(
      async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );
  });

  it("issues both atomic UPDATE statements when there are expired subs", async () => {
    tx.$executeRaw
      .mockResolvedValueOnce(3) // 3 subs expired
      .mockResolvedValueOnce(2); // 2 subscribers deactivated

    await runExpiry();

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("skips the second statement entirely when no subscriptions expire", async () => {
    tx.$executeRaw.mockResolvedValueOnce(0);

    await runExpiry();

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("swallows transaction errors so the cron loop never crashes", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error("connection lost"));

    await expect(runExpiry()).resolves.not.toThrow();
  });
});
