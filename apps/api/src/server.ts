import Fastify from "fastify";
import cors from "@fastify/cors";
import { healthRoutes } from "./routes/health.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
      name: "api-server",
    },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: process.env["CORS_ORIGIN"] ?? true,
    credentials: true,
  });

  // Routes
  await app.register(healthRoutes);

  return app;
}
