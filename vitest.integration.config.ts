import { defineConfig } from "vitest/config";

// Integration tests — require docker-compose dev stack (Postgres + Redis).
export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    testTimeout: 30_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
