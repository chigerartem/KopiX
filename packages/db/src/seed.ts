import { createPrismaClient } from "./client.js";

const prisma = createPrismaClient();

async function seed(): Promise<void> {
  console.warn("Seeding database...");

  // Subscription plans
  await prisma.plan.upsert({
    where: { id: "plan-trial-7d" },
    update: { isActive: false },
    create: {
      id: "plan-trial-7d",
      name: "Trial",
      price: 5,
      currency: "USDT",
      durationDays: 7,
      isActive: false,
    },
  });

  await prisma.plan.upsert({
    where: { id: "plan-monthly-30d" },
    update: { name: "Monthly", price: 10, currency: "USDT", durationDays: 30, isActive: true },
    create: {
      id: "plan-monthly-30d",
      name: "Monthly",
      price: 10,
      currency: "USDT",
      durationDays: 30,
      isActive: true,
    },
  });

  await prisma.plan.upsert({
    where: { id: "plan-quarterly-90d" },
    update: { isActive: false },
    create: {
      id: "plan-quarterly-90d",
      name: "Quarterly",
      price: 75,
      currency: "USDT",
      durationDays: 90,
      isActive: false,
    },
  });

  // Master account placeholder (operator populates encrypted keys via API/env)
  await prisma.masterAccount.upsert({
    where: { id: "master-account-default" },
    update: {},
    create: {
      id: "master-account-default",
      exchange: "bingx",
      apiKeyEncrypted: "PLACEHOLDER",
      apiSecretEncrypted: "PLACEHOLDER",
      isActive: false,
      connectedAt: new Date(),
    },
  });

  console.warn("Seed complete.");
}

seed()
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
