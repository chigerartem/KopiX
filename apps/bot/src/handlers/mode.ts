import type { Bot, CallbackQueryContext, CommandContext, Context, Filter } from "grammy";
import { InlineKeyboard } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";

const FIXED_SENTINEL = "💰 Введите фиксированную сумму";
const PCT_SENTINEL = "📊 Введите процент от баланса";

const MIN_FIXED = 1;
const MAX_FIXED = 10_000;
const MIN_PCT = 0.1;
const MAX_PCT = 100;

async function handleMode(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ Команда /mode работает только в личном чате с ботом.");
    return;
  }
  if (!ctx.from) return;

  const subscriber = await prisma.subscriber.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
  });

  if (!subscriber) {
    await ctx.reply("Вы ещё не зарегистрированы. Отправьте /start, чтобы начать.");
    return;
  }

  const lines: string[] = ["Выберите режим копирования:"];

  if (subscriber.copyMode === "fixed" && subscriber.fixedAmount) {
    lines.push(`\nТекущий: фиксированная сумма ${subscriber.fixedAmount.toString()} USDT`);
  } else if (subscriber.copyMode === "percentage" && subscriber.percentage) {
    lines.push(`\nТекущий: ${subscriber.percentage.toString()}% от баланса`);
  }

  const kb = new InlineKeyboard()
    .text("💰 Фиксированная сумма (USDT)", "mode:fixed")
    .row()
    .text("📊 Процент от баланса", "mode:pct");

  await ctx.reply(lines.join("\n"), { reply_markup: kb });
}

async function handleModeCallback(ctx: CallbackQueryContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery();

  if (data === "mode:fixed") {
    await ctx.reply(
      `${FIXED_SENTINEL}\n\nВведите сумму в USDT (${MIN_FIXED}–${MAX_FIXED}), например: 50`,
      { reply_markup: { force_reply: true, selective: true } },
    );
  } else if (data === "mode:pct") {
    await ctx.reply(
      `${PCT_SENTINEL}\n\nВведите процент (${MIN_PCT}–${MAX_PCT}), например: 5`,
      { reply_markup: { force_reply: true, selective: true } },
    );
  }
}

async function handleFixedReply(ctx: Filter<Context, "message:text">): Promise<void> {
  if (!ctx.from) return;

  const raw = ctx.message.text.trim().replace(",", ".");
  const amount = parseFloat(raw);

  if (!isFinite(amount) || amount < MIN_FIXED || amount > MAX_FIXED) {
    await ctx.reply(
      `❌ Введите число от ${MIN_FIXED} до ${MAX_FIXED}. Отправьте /mode и попробуйте снова.`,
    );
    return;
  }

  await prisma.subscriber.update({
    where: { telegramId: BigInt(ctx.from.id) },
    data: { copyMode: "fixed", fixedAmount: amount },
  });

  logger.info(
    { event: "bot.mode.set_fixed", telegramId: ctx.from.id, amount },
    "Copy mode set to fixed",
  );

  await ctx.reply(
    `✅ Режим установлен: ${amount} USDT на каждую сделку.\n\nСмотрите /status или открывайте /dashboard.`,
  );
}

async function handlePctReply(ctx: Filter<Context, "message:text">): Promise<void> {
  if (!ctx.from) return;

  const raw = ctx.message.text.trim().replace(",", ".");
  const pct = parseFloat(raw);

  if (!isFinite(pct) || pct < MIN_PCT || pct > MAX_PCT) {
    await ctx.reply(
      `❌ Введите число от ${MIN_PCT} до ${MAX_PCT}. Отправьте /mode и попробуйте снова.`,
    );
    return;
  }

  await prisma.subscriber.update({
    where: { telegramId: BigInt(ctx.from.id) },
    data: { copyMode: "percentage", percentage: pct },
  });

  logger.info(
    { event: "bot.mode.set_pct", telegramId: ctx.from.id, pct },
    "Copy mode set to percentage",
  );

  await ctx.reply(
    `✅ Режим установлен: ${pct}% от вашего баланса на каждую сделку.\n\nСмотрите /status или открывайте /dashboard.`,
  );
}

export function registerModeHandlers(bot: Bot): void {
  bot.command("mode", handleMode);
  bot.callbackQuery(/^mode:/, handleModeCallback);
  bot
    .on("message:text")
    .filter(
      (ctx) => ctx.message.reply_to_message?.text?.startsWith(FIXED_SENTINEL) ?? false,
      handleFixedReply,
    );
  bot
    .on("message:text")
    .filter(
      (ctx) => ctx.message.reply_to_message?.text?.startsWith(PCT_SENTINEL) ?? false,
      handlePctReply,
    );
}
