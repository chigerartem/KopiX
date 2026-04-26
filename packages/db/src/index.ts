export { PrismaClient, Prisma } from "../generated/client/index.js";
export type {
  Plan,
  Subscriber,
  Subscription,
  MasterAccount,
  TradeSignal,
  CopiedTrade,
  Position,
  PnlSnapshot,
  AdminAuditLog,
} from "../generated/client/index.js";

export { createPrismaClient } from "./client.js";
