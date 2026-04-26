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
import { validateCredentials, getBalance } from "@kopix/exchange";
import { encrypt, decrypt } from "@kopix/crypto";
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
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
    },
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

      // The copy engine assumes hedge mode (separate LONG/SHORT positions per symbol).
      // One-way mode would silently corrupt position tracking, so reject it explicitly.
      // If isHedgeMode is undefined the probe failed — treat as unknown and reject too,
      // because we cannot guarantee correctness.
      if (validation.isHedgeMode !== true) {
        await reply.status(422).send({
          error:
            "BingX account must be in Hedge Mode (separate LONG/SHORT positions). " +
            "Open BingX → Futures → Settings → Position Mode → Hedge Mode, then reconnect.",
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

  /**
   * GET /api/exchange/balance
   *
   * Returns live BingX USDT-M futures balance for the authenticated subscriber.
   * Decrypts stored credentials, calls exchange.getBalance, never logs or
   * returns the plaintext key. Returns 409 if no credentials are connected.
   */
  app.get(
    "/api/exchange/balance",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      const subscriber = await prisma.subscriber.findUnique({
        where: { id: request.subscriberId },
        select: { apiKeyEncrypted: true, apiSecretEncrypted: true },
      });

      if (!subscriber || !subscriber.apiKeyEncrypted || !subscriber.apiSecretEncrypted) {
        await reply.status(409).send({ error: "No exchange credentials connected" });
        return;
      }

      const encKey = process.env["APP_ENCRYPTION_KEY"];
      if (!encKey) {
        await reply.status(500).send({ error: "Server misconfiguration" });
        return;
      }

      try {
        const apiKey = decrypt(subscriber.apiKeyEncrypted, encKey);
        const apiSecret = decrypt(subscriber.apiSecretEncrypted, encKey);
        const balance = await getBalance({ apiKey, apiSecret });
        await reply.status(200).send({
          available: balance.available,
          total: balance.total,
          currency: balance.currency,
        });
      } catch (err) {
        request.log.warn(
          { event: "exchange.balance.failed", err: (err as Error).message },
          "failed to fetch balance",
        );
        await reply.status(502).send({ error: "Exchange balance fetch failed" });
      }
    },
  );

  /**
   * DELETE /api/exchange/credentials
   *
   * Disconnects the subscriber's BingX account by zero-ing out both
   * encrypted credential fields. Also pauses copy-trading so the engine
   * stops attempting to place orders.
   */
  app.delete(
    "/api/exchange/credentials",
    {
      preHandler: requireTmaAuth,
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    },
    async (request, reply) => {
      await prisma.subscriber.update({
        where: { id: request.subscriberId },
        data: {
          apiKeyEncrypted: null,
          apiSecretEncrypted: null,
          status: "paused",
        },
      });

      request.log.info(
        { event: "exchange.disconnected", subscriberId: request.subscriberId },
        "BingX credentials removed",
      );

      await reply.status(200).send({ disconnected: true });
    },
  );
}
