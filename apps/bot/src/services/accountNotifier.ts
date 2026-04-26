/**
 * Account notifier — surfaces non-trade account events to the user.
 *
 * The engine and API publish JSON events on Redis channel `account:{id}`.
 * Today we handle:
 *   - { type: "key_revoked", reason: "auth_failed" | "withdraw_permission_added" }
 *
 * Pub/sub channels never persist — if the bot is offline when the event
 * fires, the message is lost. The original cause (suspended subscriber,
 * cleared keys) is still recorded in DB so the user can self-discover via
 * the Mini App. This notifier is best-effort UX, not a guarantee.
 */

import { Redis } from "ioredis";
import type { Bot } from "grammy";
import { GrammyError, InlineKeyboard } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { config } from "../config.js";
import { sendMessageThrottled } from "../lib/rateLimitedSender.js";

type AccountEvent =
  | { type: "key_revoked"; reason: "auth_failed" | "withdraw_permission_added" };

const telegramIdCache = new Map<string, bigint>();

async function resolveTelegramId(subscriberId: string): Promise<bigint | null> {
  const cached = telegramIdCache.get(subscriberId);
  if (cached !== undefined) return cached;
  const row = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { telegramId: true },
  });
  if (!row) return null;
  telegramIdCache.set(subscriberId, row.telegramId);
  return row.telegramId;
}

function parseEvent(raw: string): AccountEvent | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (obj.type === "key_revoked") {
      const reason = obj.reason === "withdraw_permission_added"
        ? "withdraw_permission_added"
        : "auth_failed";
      return { type: "key_revoked", reason };
    }
    return null;
  } catch {
    return null;
  }
}

export async function startAccountNotifier(bot: Bot): Promise<void> {
  const url = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
  const sub = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: null,
  });

  sub.on("error", (err: Error) => {
    logger.error(
      { event: "accountNotifier.redis_error", err: err.message },
      "Account notifier Redis error",
    );
  });

  sub.on("pmessage", (_pattern: string, channel: string, message: string) => {
    void handleMessage(bot, channel, message);
  });

  await sub.psubscribe("account:*");
  logger.info(
    { event: "accountNotifier.started" },
    "Account notifier subscribed to account:*",
  );
}

async function handleMessage(bot: Bot, channel: string, message: string): Promise<void> {
  const subscriberId = channel.startsWith("account:")
    ? channel.slice("account:".length)
    : "";
  if (!subscriberId) return;

  const event = parseEvent(message);
  if (!event) {
    logger.warn(
      { event: "accountNotifier.parse_failed", channel },
      "Could not parse account event",
    );
    return;
  }

  const telegramId = await resolveTelegramId(subscriberId);
  if (!telegramId) return;

  const text = renderMessage(event);
  const keyboard = config.miniAppUrl
    ? new InlineKeyboard().webApp("Open Mini App", config.miniAppUrl)
    : undefined;

  try {
    await sendMessageThrottled(bot, Number(telegramId), text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400)) {
      logger.warn(
        { event: "accountNotifier.send_skipped", subscriberId, code: err.error_code },
        "Could not send account notification",
      );
      return;
    }
    logger.error(
      { event: "accountNotifier.send_failed", subscriberId, err: String(err) },
      "Failed to send account notification",
    );
  }
}

function renderMessage(event: AccountEvent): string {
  if (event.type === "key_revoked") {
    if (event.reason === "withdraw_permission_added") {
      return [
        "🚨 <b>Your BingX API key was disconnected</b>",
        "",
        "Withdraw permission was detected on your key. KopiX requires <b>trade-only</b> keys for safety.",
        "",
        "Reconnect a trade-only key in the Mini App to resume copy-trading.",
      ].join("\n");
    }
    return [
      "🚨 <b>Your BingX API key was disconnected</b>",
      "",
      "BingX rejected your credentials. The key may have been revoked, expired, or had its permissions changed.",
      "",
      "Reconnect a trade-only key in the Mini App to resume copy-trading.",
    ].join("\n");
  }
  return "";
}
