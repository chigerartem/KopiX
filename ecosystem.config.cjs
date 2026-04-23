// pm2 process manifest for KopiX.
//
// Daily flow: `git pull && npm ci && npm run build && npm run db:migrate && pm2 reload ecosystem.config.cjs --update-env`
//
// Env is loaded from /opt/kopix/.env (or CWD/.env) via Node 22's built-in
// --env-file flag — no dotenv dep required. COMMIT_SHA is injected by
// scripts/deploy.sh so the bot can cache-bust the miniapp URL.
//
// IMPORTANT: kopix-engine MUST run at instances:1, exec_mode:"fork". Two
// engines would consume the same Redis stream group and place duplicate
// orders. See docs/ARCHITECTURE.md.

const path = require("node:path");

const repoRoot = __dirname;
const envFile = path.join(repoRoot, ".env");
const nodeArgs = `--env-file=${envFile}`;

/** @type {import('pm2').StartOptions} */
const common = {
  cwd: repoRoot,
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  max_restarts: 20,
  min_uptime: "15s",
  node_args: nodeArgs,
  env: {
    NODE_ENV: "production",
  },
};

module.exports = {
  apps: [
    {
      ...common,
      name: "kopix-api",
      script: "apps/api/dist/index.js",
    },
    {
      ...common,
      name: "kopix-bot",
      script: "apps/bot/dist/index.js",
    },
    {
      ...common,
      name: "kopix-engine",
      script: "apps/engine/dist/index.js",
      // Engine is the single consumer of the BingX master-watcher + signal
      // stream. Never scale beyond 1 — duplicates would place duplicate orders.
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
