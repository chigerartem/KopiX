import pino from "pino";

export const logger = pino({
  name: "api-server",
  level: process.env["LOG_LEVEL"] ?? "info",
});
