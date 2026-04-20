/**
 * /subscribe — list active plans and handle purchases via CryptoBot.
 *
 * Flow:
 *   1. User sends /subscribe.
 *   2. Bot shows all active plans with "Купить" inline buttons.
 *   3. User taps "Купить <plan>".
 *   4. Bot creates a CryptoBot invoice and replies with a payment link.
 *   5. After payment, CryptoBot calls POST /api/webhooks/cryptobot on the API
 *      which activates the subscription and notifies the user.
 */

import { randomBytes } from "node:crypto";
import type { Bot, CallbackQueryContext, CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { createInvoice } from "../lib/cryptobot.js";

const BUY_PREFIX = "buy:";

function formatPrice(price: { toString(): string }, currency: string): string {
  return `${price.toString()} ${currency}`;
}

export async function handleSubscribe(
  ctx: CommandContext<Context>,
): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply(
      "⚠️ Команда /subscribe работает только в личном чате с ботом.",
    );
    return;
  }
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);

  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { price: "asc" },
  });

  if (plans.length === 0) {
    await ctx.reply(
      "Сейчас нет доступных подписок. Попробуйте позже — мы уже работаем над этим.",
    );
    return;
  }

  const subscriber = await prisma.subscriber.findUnique({
    where: { telegramId },
    include: {
      subscriptions: {
        where: { status: "active", expiresAt: { gt: new Date() } },
        orderBy: { expiresAt: "desc" },
        take: 1,
        include: { plan: true },
      },
    },
  });

  const current = subscriber?.subscriptions[0];

  const header: string[] = [];
  if (current) {
    const daysLeft = Math.max(
      0,
      Math.ceil(
        (current.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
      ),
    );
    header.push(
      `✅ У вас активна подписка *${current.plan.name}* — ещё ${daysLeft} дн.`,
      "Вы можете продлить её, выбрав план ниже.",
      "",
    );
  } else {
    header.push("Выберите план подписки:", "");
  }

  const lines: string[] = [...header];
  const kb = new InlineKeyboard();
  for (const p of plans) {
    lines.push(
      `• *${p.name}* — ${formatPrice(p.price, p.currency)} / ${p.durationDays} дн.`,
    );
    kb.text(
      `Купить «${p.name}» — ${formatPrice(p.price, p.currency)}`,
      `${BUY_PREFIX}${p.id}`,
    ).row();
  }

  logger.info(
    {
      event: "bot.subscribe.list",
      telegramId: ctx.from.id,
      planCount: plans.length,
    },
    "Showed subscription plans",
  );

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
}

async function handleBuyCallback(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const data = ctx.callbackQuery.data ?? "";
  const planId = data.slice(BUY_PREFIX.length);

  if (!ctx.from) return;
  const telegramId = BigInt(ctx.from.id);

  logger.info(
    { event: "bot.subscribe.buy_click", telegramId: ctx.from.id, planId },
    "Buy button clicked",
  );

  // Find subscriber
  const subscriber = await prisma.subscriber.findUnique({
    where: { telegramId },
  });
  if (!subscriber) {
    await ctx.answerCallbackQuery({
      text: "Сначала запустите /start",
      show_alert: true,
    });
    return;
  }

  // Find plan
  const plan = await prisma.plan.findFirst({
    where: { id: planId, isActive: true },
  });
  if (!plan) {
    await ctx.answerCallbackQuery({
      text: "Тариф не найден или недоступен",
      show_alert: true,
    });
    return;
  }

  // Acknowledge the callback immediately so the button stops spinning
  await ctx.answerCallbackQuery();

  // Create CryptoBot invoice
  const nonce = randomBytes(8).toString("hex");
  const payload = `${subscriber.id}:${plan.id}:${nonce}`;
  const domain = process.env["APP_DOMAIN"] ?? "localhost";

  try {
    const invoice = await createInvoice({
      asset: plan.currency,
      amount: plan.price.toString(),
      description: `KopiX — ${plan.name}`,
      payload,
      paidBtnUrl: `https://${domain}`,
    });

    const kb = new InlineKeyboard().url(
      `💳 Оплатить ${formatPrice(plan.price, plan.currency)}`,
      invoice.botInvoiceUrl,
    );

    await ctx.reply(
      [
        `💳 *Счёт создан*`,
        ``,
        `Тариф: *${plan.name}*`,
        `Сумма: *${formatPrice(plan.price, plan.currency)}*`,
        `Срок: *${plan.durationDays} дн.*`,
        ``,
        `Нажмите кнопку ниже для оплаты через CryptoBot.`,
        `После оплаты подписка активируется автоматически.`,
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: kb },
    );

    logger.info(
      {
        event: "bot.subscribe.invoice_created",
        telegramId: ctx.from.id,
        planId,
        invoiceId: invoice.invoiceId,
      },
      "CryptoBot invoice created",
    );
  } catch (err) {
    logger.error(
      { event: "bot.subscribe.invoice_failed", telegramId: ctx.from.id, err },
      "Failed to create CryptoBot invoice",
    );
    await ctx.reply(
      "❌ Не удалось создать счёт. Попробуйте позже или обратитесь в поддержку.",
    );
  }
}

export function registerSubscribeHandlers(bot: Bot): void {
  bot.command("subscribe", handleSubscribe);
  bot.callbackQuery(new RegExp(`^${BUY_PREFIX}`), handleBuyCallback);
}
