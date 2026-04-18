/**
 * /connect — BingX API key collection (architecture §13.2, §12.4).
 *
 * Two-step force_reply conversation:
 *   1. /connect  → prompt for API Key (force_reply). State marker = Step-1 sentinel.
 *   2. User replies → delete user's message (contains key!), delete our prompt,
 *      stash the key in Redis with 5-minute TTL, prompt for API Secret.
 *   3. User replies → delete user's message (contains secret!), delete our prompt,
 *      pull key from Redis, validate via @kopix/exchange, encrypt both,
 *      upsert into subscribers.{apiKeyEncrypted,apiSecretEncrypted}.
 *
 * Security invariants — these MUST hold:
 *   - Private chats only. Group chats cannot delete user messages without
 *     admin rights, and pasting exchange keys into a group is never sane.
 *   - Both key and secret messages are deleted BEFORE any other await.
 *   - Withdraw permission is a hard reject. Trade-only keys only.
 *   - Redis key carries TTL (5 min). Deleted on success or failure.
 *   - Plaintext key/secret never hit the logger (only booleans / masked IDs).
 *
 * State discriminator: we identify which step a user's reply belongs to by
 * inspecting `reply_to_message.text` for a sentinel prefix. This avoids
 * keeping per-chat message_id state.
 */

import type { Bot, CommandContext, Context, Filter } from "grammy";
import { encrypt } from "@kopix/crypto";
import { validateCredentials } from "@kopix/exchange";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { redis } from "../redis.js";
import { config } from "../config.js";

const STEP1_SENTINEL = "🔐 Шаг 1/2 — API ключ";
const STEP2_SENTINEL = "🔐 Шаг 2/2 — API секрет";

const STEP1_PROMPT = [
  STEP1_SENTINEL,
  "",
  "Отправьте ваш BingX API Key ответом на это сообщение.",
  "",
  "⚠️ Ключ должен быть *trade-only* — без прав на вывод средств.",
  "Сообщение с ключом будет удалено сразу после получения.",
].join("\n");

const STEP2_PROMPT = [
  STEP2_SENTINEL,
  "",
  "Теперь отправьте ваш BingX API Secret ответом на это сообщение.",
  "",
  "Сообщение с секретом также будет удалено сразу после получения.",
].join("\n");

const KEY_REDIS_TTL_SEC = 300; // 5 minutes — enough for a user to paste two messages

function redisKey(telegramId: number): string {
  return `bot:connect:${telegramId}:apikey`;
}

/** Entry point: user typed /connect */
export async function handleConnect(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ Команда /connect работает только в личном чате с ботом.");
    return;
  }
  if (!ctx.from) return;

  logger.info(
    { event: "bot.connect.start", telegramId: ctx.from.id },
    "Starting /connect flow",
  );

  await ctx.reply(STEP1_PROMPT, {
    parse_mode: "Markdown",
    reply_markup: { force_reply: true, selective: true },
  });
}

/**
 * Message handler for Step 1 replies — the text is the API key.
 */
async function handleStep1Reply(ctx: Filter<Context, "message:text">): Promise<void> {
  if (ctx.chat.type !== "private") return;
  if (!ctx.from) return;

  const apiKey = ctx.message.text.trim();
  const userMsgId = ctx.message.message_id;
  const promptMsgId = ctx.message.reply_to_message?.message_id;

  // CRITICAL: delete the message containing the key BEFORE any other await.
  // If anything below throws, the key must already be gone from Telegram history.
  await safeDelete(ctx, userMsgId);
  if (promptMsgId) await safeDelete(ctx, promptMsgId);

  if (!isPlausibleKey(apiKey)) {
    await ctx.reply("❌ Это не похоже на API-ключ. Отправьте /connect, чтобы начать заново.");
    return;
  }

  // Stash in Redis with TTL. Use SET + EX (atomic).
  await redis.set(redisKey(ctx.from.id), apiKey, "EX", KEY_REDIS_TTL_SEC);

  logger.info(
    { event: "bot.connect.step1_ok", telegramId: ctx.from.id },
    "API key received (not logged), prompting for secret",
  );

  await ctx.reply(STEP2_PROMPT, {
    parse_mode: "Markdown",
    reply_markup: { force_reply: true, selective: true },
  });
}

/**
 * Message handler for Step 2 replies — the text is the API secret.
 * Validates the pair, enforces trade-only, encrypts, stores on the subscriber row.
 */
async function handleStep2Reply(ctx: Filter<Context, "message:text">): Promise<void> {
  if (ctx.chat.type !== "private") return;
  if (!ctx.from) return;

  const apiSecret = ctx.message.text.trim();
  const userMsgId = ctx.message.message_id;
  const promptMsgId = ctx.message.reply_to_message?.message_id;

  // CRITICAL: delete the message containing the secret BEFORE any other await.
  await safeDelete(ctx, userMsgId);
  if (promptMsgId) await safeDelete(ctx, promptMsgId);

  const telegramId = ctx.from.id;
  const apiKey = await redis.get(redisKey(telegramId));
  // Whether success or failure, we never need the staged key again.
  await redis.del(redisKey(telegramId));

  if (!apiKey) {
    await ctx.reply(
      "⏱ Сессия истекла (ключ ждал секрет более 5 минут). Отправьте /connect заново.",
    );
    return;
  }

  if (!isPlausibleKey(apiSecret)) {
    await ctx.reply("❌ Это не похоже на API-секрет. Отправьте /connect, чтобы начать заново.");
    return;
  }

  // Validate against BingX. This is the ONLY place we touch the plaintext
  // outside of encrypt() — must never throw into a log line.
  let validation;
  try {
    validation = await validateCredentials({ apiKey, apiSecret });
  } catch (err) {
    logger.error(
      { event: "bot.connect.validate_threw", telegramId, err: (err as Error).message },
      "validateCredentials threw — treating as invalid",
    );
    await ctx.reply(
      "❌ Не удалось проверить ключи (ошибка сети или BingX). Попробуйте /connect ещё раз через минуту.",
    );
    return;
  }

  if (!validation.valid) {
    logger.info(
      { event: "bot.connect.invalid", telegramId, error: validation.error },
      "Credentials rejected by BingX",
    );
    await ctx.reply(
      `❌ Ключи отклонены BingX: ${validation.error ?? "неизвестная ошибка"}.\nОтправьте /connect, чтобы попробовать ещё раз.`,
    );
    return;
  }

  if (validation.hasWithdrawPermission) {
    logger.warn(
      { event: "bot.connect.withdraw_permission", telegramId },
      "Rejecting keys with withdraw permission",
    );
    await ctx.reply(
      [
        "🚫 У этих ключей есть право на вывод средств.",
        "",
        "KopiX не принимает такие ключи — создайте новый API-ключ на BingX",
        "*без* права на вывод (withdraw off), и отправьте /connect заново.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }

  if (!validation.hasTradePermission) {
    await ctx.reply(
      "❌ У ключей нет права на торговлю. Включите trade-право и отправьте /connect заново.",
    );
    return;
  }

  // All good — encrypt and persist.
  const encryptedKey = encrypt(apiKey, config.encryptionKey);
  const encryptedSecret = encrypt(apiSecret, config.encryptionKey);

  await prisma.subscriber.update({
    where: { telegramId: BigInt(telegramId) },
    data: {
      apiKeyEncrypted: encryptedKey,
      apiSecretEncrypted: encryptedSecret,
    },
  });

  logger.info(
    {
      event: "bot.connect.success",
      telegramId,
      futuresBalance: validation.futuresBalance,
    },
    "API keys stored encrypted",
  );

  await ctx.reply(
    [
      "✅ BingX подключён!",
      "",
      validation.futuresBalance !== undefined
        ? `Баланс фьючерсов: ${validation.futuresBalance} USDT`
        : "",
      "",
      "Дальше:",
      "• /subscribe — выбрать подписку",
      "• /mode — настроить режим копирования",
      "• /status — статус подписки",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** Delete a message, swallowing the error (bot may lack rights, message already gone, etc). */
async function safeDelete(ctx: Context, messageId: number): Promise<void> {
  try {
    await ctx.api.deleteMessage(ctx.chat!.id, messageId);
  } catch (err) {
    logger.warn(
      { event: "bot.connect.delete_failed", err: (err as Error).message, messageId },
      "Failed to delete message (continuing)",
    );
  }
}

/** Cheap sanity filter: reject obvious non-keys (spaces, too short). */
function isPlausibleKey(s: string): boolean {
  return s.length >= 16 && s.length <= 256 && !/\s/.test(s);
}

/**
 * Register /connect and its two reply handlers on the bot.
 * Reply handlers are keyed off `reply_to_message.text` sentinel prefixes
 * so state lives in the Telegram message thread itself.
 */
export function registerConnectHandlers(bot: Bot): void {
  bot.command("connect", handleConnect);

  bot
    .on("message:text")
    .filter(
      (ctx) => ctx.message.reply_to_message?.text?.startsWith(STEP1_SENTINEL) ?? false,
      handleStep1Reply,
    );

  bot
    .on("message:text")
    .filter(
      (ctx) => ctx.message.reply_to_message?.text?.startsWith(STEP2_SENTINEL) ?? false,
      handleStep2Reply,
    );
}
