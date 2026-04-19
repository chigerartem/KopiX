/**
 * Register / refresh the Telegram bot webhook.
 *
 * Idempotent — safe to run on every deploy. Called by scripts/deploy.sh.
 *
 *   node --env-file=.env --import tsx/esm scripts/register-webhook.ts
 *
 * Reads:
 *   TELEGRAM_BOT_TOKEN  (required)
 *   APP_DOMAIN          (required, e.g. kopix.example.com)
 *   BOT_WEBHOOK_SECRET  (required, shared secret Telegram echoes in the header)
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`error: ${name} is not set in the environment`);
    process.exit(1);
  }
  return v;
}

const token = required("TELEGRAM_BOT_TOKEN");
const domain = required("APP_DOMAIN");
const secret = required("BOT_WEBHOOK_SECRET");

const webhookUrl = `https://${domain}/api/bot/webhook`;

const body = new URLSearchParams({
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: JSON.stringify(["message", "callback_query"]),
});

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
});

const json = (await res.json()) as { ok: boolean; description?: string };

if (!res.ok || !json.ok) {
  console.error("setWebhook failed:", json);
  process.exit(1);
}

console.log(`webhook registered: ${webhookUrl} (${json.description ?? "ok"})`);
