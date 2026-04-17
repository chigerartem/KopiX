import { Redis } from "ioredis";
import { logger } from "../logger.js";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (client) return client;

  const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: null, // let ioredis retry indefinitely (needed for streams)
    enableReadyCheck: true,
  });

  client.on("connect", () => logger.info({ event: "redis.connected" }, "Redis connected"));
  client.on("error", (err: Error) => logger.error({ event: "redis.error", err }, "Redis error"));
  client.on("close", () => logger.warn({ event: "redis.closed" }, "Redis connection closed"));

  return client;
}
