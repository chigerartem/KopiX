import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createPrismaClient } from "@kopix/db";
import { createInvoice } from "../lib/cryptobot.js";
import { requireTmaAuth } from "../middleware/auth.js";

const prisma = createPrismaClient();

const CreateInvoiceBody = z.object({
  planId: z.string().uuid(),
});

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/subscriptions/create-invoice",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const parseResult = CreateInvoiceBody.safeParse(request.body);
      if (!parseResult.success) {
        await reply.status(400).send({ error: "Invalid request body", details: parseResult.error.flatten() });
        return;
      }

      const { planId } = parseResult.data;

      const plan = await prisma.plan.findFirst({ where: { id: planId, isActive: true } });
      if (!plan) {
        await reply.status(404).send({ error: "Plan not found or inactive" });
        return;
      }

      const subscriber = await prisma.subscriber.findUniqueOrThrow({
        where: { id: request.subscriberId },
      });

      const domain = process.env["APP_DOMAIN"] ?? "localhost";
      const nonce = randomBytes(8).toString("hex");
      const payload = `${subscriber.id}:${plan.id}:${nonce}`;

      let invoice;
      try {
        invoice = await createInvoice({
          asset: plan.currency,
          amount: plan.price.toString(),
          description: `KopiX Subscription — ${plan.name}`,
          payload,
          paidBtnUrl: `https://${domain}/payment-success`,
        });
      } catch (err) {
        request.log.error(
          { event: "subscriptions.invoice_failed", err: (err as Error).message },
          "Failed to create CryptoBot invoice",
        );
        await reply.status(502).send({ error: "Payment provider unavailable. Try again later." });
        return;
      }

      request.log.info(
        { event: "subscriptions.invoice_created", subscriberId: request.subscriberId, planId, invoiceId: invoice.invoiceId },
        "CryptoBot invoice created",
      );

      await reply.send({
        invoiceId: invoice.invoiceId,
        miniAppInvoiceUrl: invoice.miniAppInvoiceUrl,
        botInvoiceUrl: invoice.botInvoiceUrl,
      });
    },
  );
}
