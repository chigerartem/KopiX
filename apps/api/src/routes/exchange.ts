/**
 * POST /api/exchange/validate
 *
 * Validates subscriber BingX API credentials (architecture §13.3):
 *   1. Call exchange.validateCredentials — fetches futures balance to confirm auth
 *   2. Reject if withdraw permission is detected (key must be trade-only)
 *   3. Encrypt key + secret with AES-256-GCM
 *   4. Store encrypted values on subscriber row
 *   5. Never return the credentials in any response
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateCredentials } from "@kopix/exchange";
import { encrypt } from "@kopix/crypto";
import { createPrismaClient } from "@kopix/db";
import { requireTmaAuth } from "../middleware/auth.js";

const prisma = createPrismaClient();

const ConnectBody = z.object({
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});

export async function exchangeRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/exchange/validate",
    { preHandler: requireTmaAuth },
    async (request, reply) => {
      const parseResult = ConnectBody.safeParse(request.body);
      if (!parseResult.success) {
        await reply.status(400).send({ error: "Invalid request body", details: parseResult.error.flatten() });
        return;
      }

      const { apiKey, apiSecret } = parseResult.data;

      // Validate credentials against BingX
      const validation = await validateCredentials({ apiKey, apiSecret });

      if (!validation.valid) {
        await reply.status(422).send({
          error: "Invalid API credentials",
          detail: validation.error ?? "Validation failed",
        });
        return;
      }

      if (validation.hasWithdrawPermission) {
        await reply.status(422).send({
          error: "API key must not have withdraw permission. Please create a trade-only key.",
        });
        return;
      }

      // Encrypt and store — plaintext key never persisted
      const encKey = process.env["APP_ENCRYPTION_KEY"];
      if (!encKey) {
        await reply.status(500).send({ error: "Server misconfiguration" });
        return;
      }

      const apiKeyEncrypted = encrypt(apiKey, encKey);
      const apiSecretEncrypted = encrypt(apiSecret, encKey);

      await prisma.subscriber.update({
        where: { id: request.subscriberId },
        data: { apiKeyEncrypted, apiSecretEncrypted },
      });

      request.log.info(
        { event: "exchange.connected", subscriberId: request.subscriberId },
        "BingX credentials stored",
      );

      await reply.status(200).send({
        connected: true,
        futuresBalance: validation.futuresBalance ?? 0,
      });
    },
  );
}
