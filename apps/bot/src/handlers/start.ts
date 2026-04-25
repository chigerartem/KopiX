/**
 * /start — registration and welcome.
 *
 * The bot is intentionally read-only: all interactive flows (API key
 * connection, copy settings, subscription) live in the Mini App. /start
 * therefore just upserts the subscriber row, prints a short EN intro, and
 * exposes a single "Open Mini App" button.
 *
 * The "How it works" guide URL will be supplied later — when present, a
 * second button is added; while empty, that button is hidden.
 */

import { InlineKeyboard, type CommandContext, type Context } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { config } from "../config.js";

// Future: replace with the public guide URL. Empty string keeps the button hidden.
const GUIDE_URL = "";

const INTRO = [
  "Welcome to KopiX — automated copy-trading on BingX.",
  "",
  "We mirror every trade of our master trader to your BingX account in real time, sized by your own rules. The Mini App is where you connect your API key, choose a copy mode, and manage your subscription.",
  "",
  "This bot will keep you posted: you'll get a notification whenever a trade is opened or closed on your account.",
].join("\n");

function buildKeyboard(): InlineKeyboard | null {
  if (!config.miniAppUrl) return null;
  const kb = new InlineKeyboard().webApp("Open Mini App", config.miniAppUrl);
  if (GUIDE_URL) {
    kb.row().url("How it works", GUIDE_URL);
  }
  return kb;
}

export async function handleStart(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from;
  if (!from) return; // command came from a channel post — ignore

  const telegramId = BigInt(from.id);

  const existing = await prisma.subscriber.findUnique({
    where: { telegramId },
  });

  const subscriber = await prisma.subscriber.upsert({
    where: { telegramId },
    update: {
      telegramUsername: from.username ?? null,
    },
    create: {
      telegramId,
      telegramUsername: from.username ?? null,
      status: "inactive",
    },
  });

  const isNew = !existing;

  logger.info(
    { event: "bot.start", telegramId: from.id, subscriberId: subscriber.id, isNew },
    isNew ? "Registered new subscriber" : "Returning subscriber",
  );

  const keyboard = buildKeyboard();
  await ctx.reply(INTRO, keyboard ? { reply_markup: keyboard } : undefined);
}
