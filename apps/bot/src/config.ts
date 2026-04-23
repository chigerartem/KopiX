/**
 * Runtime environment for the bot.
 *
 * Read-once on module init so handlers can reference typed, non-null
 * values without scattering `process.env[...]` checks throughout.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is required`);
  return v;
}

// Telegram caches WebApp content by URL. Appending ?v=<commit-sha> forces a
// fresh fetch on every deploy so clients can't keep serving the old build.
function buildMiniAppUrl(): string {
  const base = process.env["MINIAPP_URL"] ?? "";
  if (!base) return "";
  const version = process.env["COMMIT_SHA"];
  if (!version) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}v=${encodeURIComponent(version)}`;
}

export const config = {
  encryptionKey: required("APP_ENCRYPTION_KEY"),
  miniAppUrl: buildMiniAppUrl(),
};
