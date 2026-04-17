import { buildServer } from "./server.js";
import { logger } from "./logger.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function main(): Promise<void> {
  const app = await buildServer();

  await app.listen({ port: PORT, host: HOST });
  logger.info({ event: "api.started", port: PORT }, `API server listening on ${HOST}:${PORT}`);

  const shutdown = async (): Promise<void> => {
    logger.info({ event: "api.shutdown" }, "Shutting down API server");
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err: unknown) => {
  logger.error({ event: "api.fatal", err }, "Fatal error");
  process.exit(1);
});
