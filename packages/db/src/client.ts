import { PrismaClient } from "../generated/client/index.js";

let instance: PrismaClient | null = null;

export function createPrismaClient(): PrismaClient {
  if (instance) return instance;

  instance = new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  });

  return instance;
}
