import pino from "pino";

export const logger = pino({
  name: "trade-engine",
  level: process.env["LOG_LEVEL"] ?? "info",
});
