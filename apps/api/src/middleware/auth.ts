/**
 * Telegram Mini App authentication middleware (architecture §14.1, §19.3).
 *
 * Every authenticated request carries:
 *   Authorization: TMA <initData>
 *
 * Validation steps:
 *   1. Parse the URL-encoded initData
 *   2. Extract and remove the 'hash' field
 *   3. Sort remaining params alphabetically, join as "key=value\n..."
 *   4. HMAC-SHA-256 of that string using key = HMAC-SHA-256("WebAppData", botToken)
 *   5. Compare expected hash to provided hash (constant-time)
 *   6. Reject if auth_date is older than 5 minutes
 *
 * On success: attaches `request.tmaUser` with the parsed Telegram user.
 * On failure: returns 401.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { createPrismaClient } from "@kopix/db";

export interface TmaUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

// Augment Fastify request type
declare module "fastify" {
  interface FastifyRequest {
    tmaUser: TmaUser;
    subscriberId: string;
  }
}

const prisma = createPrismaClient();

function hmacSha256(data: string, key: string | Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export function validateInitData(initData: string, botToken: string): TmaUser {
  const params = new URLSearchParams(initData);
  const providedHash = params.get("hash");
  if (!providedHash) throw new Error("Missing hash");

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // Per Telegram spec: secret_key = HMAC-SHA256(key="WebAppData", msg=bot_token)
  const secretKey = hmacSha256(botToken, "WebAppData");
  const expectedHash = hmacSha256(dataCheckString, secretKey).toString("hex");

  // Constant-time comparison
  const a = Buffer.from(expectedHash, "hex");
  const b = Buffer.from(providedHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid hash");
  }

  const authDate = parseInt(params.get("auth_date") ?? "0", 10);
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > 300) throw new Error("initData expired");

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Missing user field");

  return JSON.parse(userRaw) as TmaUser;
}

/**
 * Fastify preHandler — validates TMA initData, upserts subscriber row,
 * attaches tmaUser and subscriberId to request.
 */
export async function requireTmaAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"];
  if (!botToken) {
    await reply.status(500).send({ error: "Server misconfiguration" });
    return;
  }

  const authHeader = request.headers["authorization"];
  if (!authHeader?.startsWith("TMA ")) {
    await reply.status(401).send({ error: "Missing TMA authorization" });
    return;
  }

  const initData = authHeader.slice(4);

  let tmaUser: TmaUser;
  try {
    tmaUser = validateInitData(initData, botToken);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    await reply.status(401).send({ error: msg });
    return;
  }

  // Upsert subscriber record (first contact creates the row)
  const subscriber = await prisma.subscriber.upsert({
    where: { telegramId: BigInt(tmaUser.id) },
    update: {
      telegramUsername: tmaUser.username ?? null,
    },
    create: {
      telegramId: BigInt(tmaUser.id),
      telegramUsername: tmaUser.username ?? null,
      status: "inactive",
    },
  });

  request.tmaUser = tmaUser;
  request.subscriberId = subscriber.id;
}
