/**
 * One-time script: encrypts BingX master API credentials and inserts
 * (or upserts) the master_accounts row.
 *
 * Usage:
 *   node --env-file-if-exists=.env --import tsx/esm scripts/seed-master.ts \
 *     <BINGX_API_KEY> <BINGX_API_SECRET>
 *
 * Or via npm (from repo root):
 *   npm run seed:master -- <BINGX_API_KEY> <BINGX_API_SECRET>
 */

import { encrypt } from "@kopix/crypto";
import { createPrismaClient } from "@kopix/db";

const [, , apiKey, apiSecret] = process.argv;

if (!apiKey || !apiSecret) {
  console.error("Usage: seed-master.ts <BINGX_API_KEY> <BINGX_API_SECRET>");
  process.exit(1);
}

const encKey = process.env["APP_ENCRYPTION_KEY"];
if (!encKey) {
  console.error("APP_ENCRYPTION_KEY env var is not set");
  process.exit(1);
}

const prisma = createPrismaClient();

async function main(): Promise<void> {
  const apiKeyEncrypted    = encrypt(apiKey, encKey as string);
  const apiSecretEncrypted = encrypt(apiSecret, encKey as string);

  // Deactivate any existing master accounts first
  await prisma.masterAccount.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });

  const master = await prisma.masterAccount.create({
    data: {
      exchange: "bingx",
      apiKeyEncrypted,
      apiSecretEncrypted,
      isActive: true,
      connectedAt: new Date(),
    },
  });

  console.log("✓ Master account created:", master.id);
  console.log("  exchange:   ", master.exchange);
  console.log("  isActive:   ", master.isActive);
  console.log("  connectedAt:", master.connectedAt.toISOString());
  console.log("\nEngine will decrypt on next start with APP_ENCRYPTION_KEY.");
}

main()
  .catch((err: unknown) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
