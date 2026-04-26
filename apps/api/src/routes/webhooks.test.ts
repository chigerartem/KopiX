/**
 * End-to-end-ish tests for the CryptoBot webhook route.
 *
 * The route is mounted on a real Fastify instance with all I/O dependencies
 * mocked: Prisma, Telegram fetch, and the HMAC signature check. We exercise
 * the full request → reply path so the rawBody preParsing hook + signature
 * verification + payload validation all run as in production.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const prismaMock = vi.hoisted(() => ({
  subscription: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  subscriber: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  plan: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

const verifyMock = vi.hoisted(() => vi.fn());

vi.mock("@kopix/db", () => ({
  createPrismaClient: () => prismaMock,
}));

vi.mock("../lib/cryptobot.js", () => ({
  verifyWebhookSignature: verifyMock,
}));

import { webhookRoutes } from "./webhooks.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(webhookRoutes);
  return app;
}

const validPayload = {
  update_type: "invoice_paid",
  payload: {
    invoice_id: 1001,
    status: "paid",
    asset: "USDT",
    amount: "10",
    payload: "sub-1:plan-1:nonce",
  },
};

describe("CryptoBot webhook", () => {
  beforeEach(() => {
    Object.values(prismaMock.subscription).forEach((f) => f.mockReset?.());
    Object.values(prismaMock.subscriber).forEach((f) => f.mockReset?.());
    prismaMock.plan.findUnique.mockReset();
    prismaMock.$transaction.mockReset().mockResolvedValue([]);
    verifyMock.mockReset();
  });

  async function post(app: ReturnType<typeof Fastify>, body: unknown, signature?: string) {
    return app.inject({
      method: "POST",
      url: "/api/webhooks/cryptobot",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-crypto-pay-api-signature": signature } : {}),
      },
      payload: JSON.stringify(body),
    });
  }

  it("rejects requests without a signature header", async () => {
    const app = await buildApp();
    const res = await post(app, validPayload);
    expect(res.statusCode).toBe(400);
  });

  it("rejects requests with an invalid signature", async () => {
    verifyMock.mockReturnValue(false);
    const app = await buildApp();
    const res = await post(app, validPayload, "deadbeef");
    expect(res.statusCode).toBe(401);
  });

  it("ignores duplicate invoices (idempotent — returns 200)", async () => {
    verifyMock.mockReturnValue(true);
    prismaMock.subscription.findFirst.mockResolvedValueOnce({ id: "existing" });
    const app = await buildApp();
    const res = await post(app, validPayload, "anysig");
    expect(res.statusCode).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to activate when paid amount is below plan price", async () => {
    verifyMock.mockReturnValue(true);
    prismaMock.subscription.findFirst.mockResolvedValueOnce(null);
    prismaMock.subscriber.findUnique.mockResolvedValueOnce({
      id: "sub-1",
      telegramId: 12345n,
    });
    prismaMock.plan.findUnique.mockResolvedValueOnce({
      id: "plan-1",
      price: 10,
      currency: "USDT",
      durationDays: 30,
      name: "Monthly",
    });

    const app = await buildApp();
    const res = await post(
      app,
      {
        ...validPayload,
        payload: { ...validPayload.payload, amount: "0.01" },
      },
      "sig",
    );
    expect(res.statusCode).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to activate when paid currency does not match plan currency", async () => {
    verifyMock.mockReturnValue(true);
    prismaMock.subscription.findFirst.mockResolvedValueOnce(null);
    prismaMock.subscriber.findUnique.mockResolvedValueOnce({
      id: "sub-1",
      telegramId: 12345n,
    });
    prismaMock.plan.findUnique.mockResolvedValueOnce({
      id: "plan-1",
      price: 10,
      currency: "USDT",
      durationDays: 30,
      name: "Monthly",
    });

    const app = await buildApp();
    const res = await post(
      app,
      {
        ...validPayload,
        payload: { ...validPayload.payload, asset: "TON" },
      },
      "sig",
    );
    expect(res.statusCode).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("activates when amount + currency match", async () => {
    verifyMock.mockReturnValue(true);
    prismaMock.subscription.findFirst.mockResolvedValueOnce(null);
    prismaMock.subscriber.findUnique.mockResolvedValueOnce({
      id: "sub-1",
      telegramId: 12345n,
    });
    prismaMock.plan.findUnique.mockResolvedValueOnce({
      id: "plan-1",
      price: 10,
      currency: "USDT",
      durationDays: 30,
      name: "Monthly",
    });

    const app = await buildApp();
    const res = await post(app, validPayload, "sig");
    expect(res.statusCode).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and ignores bad payload string (no subscriber/plan parts)", async () => {
    verifyMock.mockReturnValue(true);
    prismaMock.subscription.findFirst.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await post(
      app,
      { ...validPayload, payload: { ...validPayload.payload, payload: "garbage" } },
      "sig",
    );
    expect(res.statusCode).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
