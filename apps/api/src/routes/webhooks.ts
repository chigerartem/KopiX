import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createPrismaClient } from "@kopix/db";
import { verifyWebhookSignature } from "../lib/cryptobot.js";

const prisma = createPrismaClient();

// Augment request with rawBody captured in preParsing
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

interface CryptoBotInvoicePayload {
  invoice_id: number;
  status: string;
  asset: string;
  amount: string;
  payload?: string;
}

interface CryptoBotWebhook {
  update_type: string;
  payload: CryptoBotInvoicePayload;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Capture raw body before Fastify parses JSON — needed for HMAC verification.
  // Scoped to this plugin so it only fires for /api/webhooks/* routes.
  app.addHook("preParsing", async (request, _reply, payload) => {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      (payload as NodeJS.ReadableStream).on("data", (chunk: unknown) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      });
      (payload as NodeJS.ReadableStream).on("end", resolve);
      (payload as NodeJS.ReadableStream).on("error", reject);
    });

    const raw = Buffer.concat(chunks);
    request.rawBody = raw.toString("utf8");

    const stream = new Readable({ read() {} });
    stream.push(raw);
    stream.push(null);
    return stream;
  });

  app.post("/api/webhooks/cryptobot", async (request: FastifyRequest, reply) => {
    const signature = request.headers["x-crypto-pay-api-signature"];
    if (typeof signature !== "string" || !signature) {
      await reply.status(400).send({ error: "Missing signature" });
      return;
    }

    const rawBody = request.rawBody ?? "";
    if (!verifyWebhookSignature(rawBody, signature)) {
      request.log.warn({ event: "webhook.cryptobot.bad_signature" }, "Invalid CryptoBot webhook signature");
      await reply.status(401).send({ error: "Invalid signature" });
      return;
    }

    let webhook: CryptoBotWebhook;
    try {
      webhook = JSON.parse(rawBody) as CryptoBotWebhook;
    } catch {
      await reply.status(400).send({ error: "Invalid JSON" });
      return;
    }

    // Only act on paid invoices; return 200 for anything else so CryptoBot stops retrying
    if (webhook.update_type !== "invoice_paid" || webhook.payload.status !== "paid") {
      await reply.status(200).send({ ok: true });
      return;
    }

    const invoiceId = String(webhook.payload.invoice_id);

    // Idempotency — CryptoBot may retry deliveries
    const existing = await prisma.subscription.findFirst({
      where: { cryptobotInvoiceId: invoiceId },
    });
    if (existing) {
      request.log.info({ event: "webhook.cryptobot.duplicate", invoiceId }, "Duplicate webhook ignored");
      await reply.status(200).send({ ok: true });
      return;
    }

    // payload format: subscriberId:planId:nonce
    const parts = (webhook.payload.payload ?? "").split(":");
    const subscriberId = parts[0];
    const planId = parts[1];

    if (!subscriberId || !planId) {
      request.log.error({ event: "webhook.cryptobot.bad_payload", raw: webhook.payload.payload }, "Cannot parse invoice payload");
      await reply.status(200).send({ ok: true });
      return;
    }

    const [subscriber, plan] = await Promise.all([
      prisma.subscriber.findUnique({ where: { id: subscriberId } }),
      prisma.plan.findUnique({ where: { id: planId } }),
    ]);

    if (!subscriber || !plan) {
      request.log.error({ event: "webhook.cryptobot.not_found", subscriberId, planId }, "Subscriber or plan not found");
      await reply.status(200).send({ ok: true });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.subscription.create({
        data: {
          subscriberId: subscriber.id,
          planId: plan.id,
          status: "active",
          startedAt: now,
          expiresAt,
          cryptobotInvoiceId: invoiceId,
          amountPaid: webhook.payload.amount,
          currency: webhook.payload.asset,
        },
      }),
      prisma.subscriber.update({
        where: { id: subscriber.id },
        data: { status: "active" },
      }),
    ]);

    request.log.info(
      { event: "webhook.cryptobot.activated", subscriberId: subscriber.id, planId, invoiceId, expiresAt },
      "Subscription activated",
    );

    // Non-blocking: notify subscriber via Telegram. Failure must not affect the 200 response.
    void notifySubscriber(subscriber.telegramId, plan.name, plan.durationDays, expiresAt).catch((err: Error) => {
      request.log.warn({ event: "webhook.cryptobot.notify_failed", err: err.message }, "Failed to send Telegram confirmation");
    });

    await reply.status(200).send({ ok: true });
  });
}

async function notifySubscriber(
  telegramId: bigint,
  planName: string,
  durationDays: number,
  expiresAt: Date,
): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) return;

  const text = [
    `✅ Оплата получена! Подписка «${planName}» активна.`,
    "",
    `Срок: ${durationDays} дн. — истекает ${expiresAt.toISOString().slice(0, 10)}.`,
    "",
    "Копирование сделок запущено. Откройте /status или /dashboard для мониторинга.",
  ].join("\n");

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramId.toString(), text }),
  });
}
