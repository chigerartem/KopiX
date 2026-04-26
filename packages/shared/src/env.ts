/**
 * Centralized environment-variable validation.
 *
 * Each service calls `validateEnv("api" | "engine" | "bot")` at startup so
 * misconfiguration surfaces immediately with a clear list of missing keys
 * — not lazily on the first request that happens to need a given var.
 */

export type Service = "api" | "engine" | "bot";

interface VarSpec {
  name: string;
  /** If true, value must be present and non-empty. */
  required: boolean;
  /** Optional extra check — return null if ok, error string otherwise. */
  validate?: (value: string) => string | null;
  description?: string;
}

const COMMON: VarSpec[] = [
  { name: "DATABASE_URL", required: true, validate: validatePostgresUrl },
  { name: "REDIS_URL", required: true, validate: validateRedisUrl },
];

const ENCRYPTION_KEY: VarSpec = {
  name: "APP_ENCRYPTION_KEY",
  required: true,
  validate: validateEncryptionKey,
  description: "32-byte base64 key. Generate with: openssl rand -base64 32",
};

const SPECS: Record<Service, VarSpec[]> = {
  api: [
    ...COMMON,
    ENCRYPTION_KEY,
    { name: "TELEGRAM_BOT_TOKEN", required: true, validate: validateBotToken },
    { name: "CRYPTOBOT_API_TOKEN", required: true },
    { name: "ADMIN_SECRET", required: true, validate: minLength(16) },
    { name: "MINIAPP_URL", required: true, validate: validateHttpsUrl },
    {
      name: "CORS_ORIGIN",
      required: isProduction(),
      description: "Required in production. Comma-separated list of allowed origins.",
    },
  ],
  engine: [
    ...COMMON,
    ENCRYPTION_KEY,
    { name: "MASTER_API_KEY", required: true, validate: minLength(8) },
    { name: "MASTER_API_SECRET", required: true, validate: minLength(8) },
  ],
  bot: [
    ...COMMON,
    { name: "TELEGRAM_BOT_TOKEN", required: true, validate: validateBotToken },
    { name: "BOT_WEBHOOK_SECRET", required: true, validate: minLength(16) },
    { name: "MINIAPP_URL", required: true, validate: validateHttpsUrl },
  ],
};

export function validateEnv(service: Service): void {
  const errors: string[] = [];

  for (const spec of SPECS[service]) {
    const value = process.env[spec.name];

    if (!value || value.trim() === "") {
      if (spec.required) {
        errors.push(
          `  - ${spec.name} is required${spec.description ? ` (${spec.description})` : ""}`,
        );
      }
      continue;
    }

    if (spec.validate) {
      const err = spec.validate(value);
      if (err) errors.push(`  - ${spec.name}: ${err}`);
    }
  }

  if (errors.length > 0) {
    const msg =
      `Environment validation failed for service "${service}":\n` +
      errors.join("\n") +
      `\n\nFix the above and restart.`;
    // Throwing rather than process.exit so callers can format/log it via their own logger.
    throw new Error(msg);
  }
}

// ───────────────────────── helpers ─────────────────────────

function isProduction(): boolean {
  return process.env["NODE_ENV"] === "production";
}

function minLength(n: number): (v: string) => string | null {
  return (v) => (v.length < n ? `must be at least ${n} chars` : null);
}

function validatePostgresUrl(v: string): string | null {
  if (!/^postgres(ql)?:\/\//.test(v)) return "must start with postgres:// or postgresql://";
  return null;
}

function validateRedisUrl(v: string): string | null {
  if (!/^rediss?:\/\//.test(v)) return "must start with redis:// or rediss://";
  return null;
}

function validateHttpsUrl(v: string): string | null {
  if (isProduction() && !/^https:\/\//.test(v)) return "must use https:// in production";
  if (!/^https?:\/\//.test(v)) return "must be a valid http(s) URL";
  return null;
}

function validateBotToken(v: string): string | null {
  // Telegram bot tokens look like 1234567890:ABC-DEF... — numeric ID then colon then opaque.
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(v)) {
    return "does not look like a valid Telegram bot token (format: 12345:ABC...)";
  }
  return null;
}

function validateEncryptionKey(v: string): string | null {
  // Must decode to exactly 32 bytes (AES-256-GCM key).
  if (/REPLACE|placeholder|example/i.test(v)) {
    return "appears to be a placeholder value — generate a real key with `openssl rand -base64 32`";
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(v, "base64");
  } catch {
    return "must be valid base64";
  }
  if (buf.length !== 32) {
    return `must decode to 32 bytes (got ${buf.length}). Generate with: openssl rand -base64 32`;
  }
  return null;
}
