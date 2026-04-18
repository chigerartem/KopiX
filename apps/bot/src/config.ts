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

export const config = {
  encryptionKey: required("APP_ENCRYPTION_KEY"),
  miniAppUrl: process.env["MINIAPP_URL"] ?? "",
};
