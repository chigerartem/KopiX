/**
 * Register the CryptoBot payment webhook.
 *
 * Idempotent — safe to run on every deploy. Called by scripts/deploy.sh.
 *
 *   node --env-file=.env --import tsx/esm scripts/register-cryptobot-webhook.ts
 *
 * Reads:
 *   CRYPTOBOT_API_TOKEN  (required)
 *   APP_DOMAIN           (required, e.g. kopix.online)
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`error: ${name} is not set in the environment`);
    process.exit(1);
  }
  return v;
}

const token = required("CRYPTOBOT_API_TOKEN");
const domain = required("APP_DOMAIN");

const webhookUrl = `https://${domain}/api/webhooks/cryptobot`;

type ApiResponse = {
  ok: boolean;
  result?: unknown;
  error?: { name: string; code: number };
};

async function main() {
  // First check current webhook
  const getRes = await fetch("https://pay.crypt.bot/api/getWebhookInfo", {
    headers: { "Crypto-Pay-API-Token": token },
  });
  const current = (await getRes.json()) as ApiResponse;
  if (current.ok) {
    const info = current.result as { url?: string } | undefined;
    if (info?.url === webhookUrl) {
      console.log(`cryptobot webhook already set: ${webhookUrl}`);
      return;
    }
  }

  // Set webhook
  const res = await fetch("https://pay.crypt.bot/api/setWebhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Crypto-Pay-API-Token": token,
    },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const data = (await res.json()) as ApiResponse;

  if (!res.ok || !data.ok) {
    if (data.error?.name === "METHOD_NOT_FOUND" || data.error?.code === 405) {
      console.warn(
        `[cryptobot] setWebhook not available via API — set it manually in @CryptoBot:\n` +
        `  Crypto Pay → My Apps → your app → Webhooks → ${webhookUrl}`,
      );
      // Not fatal: the webhook may already be configured through the bot UI
      return;
    }
    console.error("setWebhook failed:", JSON.stringify(data));
    process.exit(1);
  }

  console.log(`cryptobot webhook registered: ${webhookUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
