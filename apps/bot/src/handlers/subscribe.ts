/**
 * /subscribe — list active plans and let the user start a purchase.
 *
 * Architecture §13.2: the command shows all plans with `isActive = true`,
 * highlights the user's current subscription (if any), and exposes an
 * inline "Купить" button per plan. Clicking the button enqueues an
 * invoice via CryptoBot — that step lands in Phase 5. For Phase 4 the
 * callback handler is a deliberate stub so the UX is discoverable now
 * and the plumbing stays stable when payments arrive.
 */

import type { Bot, CallbackQueryContext, CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";

const BUY_PREFIX = "buy:";

function formatPrice(price: { toString(): string }, currency: string): string {
  return `${price.toString()} ${currency}`;
}

export async function handleSubscribe(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ Команда /subscribe работает только в личном чате с ботом.");
    return;
  }
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);

  // Plans are tiny, read them all sorted by price.
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

  // Look up the most recent active subscription so we can show "у вас уже активна" context.
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
      Math.ceil((current.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
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
    kb.text(`Купить «${p.name}» — ${formatPrice(p.price, p.currency)}`, `${BUY_PREFIX}${p.id}`).row();
  }

  logger.info(
    { event: "bot.subscribe.list", telegramId: ctx.from.id, planCount: plans.length },
    "Showed subscription plans",
  );

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
}

/**
 * Callback for `buy:<planId>` buttons.
 *
 * Phase 4: acknowledge the click and tell the user payment lands in the
 * next update. Phase 5 replaces the body with a real CryptoBot invoice
 * creation (createInvoice → save pending Subscription → reply with
 * pay URL in an inline button).
 */
async function handleBuyCallback(ctx: CallbackQueryContext<Context>): Promise<void> {
  const data = ctx.callbackQuery.data ?? "";
  const planId = data.slice(BUY_PREFIX.length);

  logger.info(
    { event: "bot.subscribe.buy_click", telegramId: ctx.from.id, planId },
    "Buy button clicked (payment pending implementation)",
  );

  await ctx.answerCallbackQuery({
    text: "Оплата через CryptoBot появится в ближайшем обновлении.",
    show_alert: true,
  });
}

export function registerSubscribeHandlers(bot: Bot): void {
  bot.command("subscribe", handleSubscribe);
  bot.callbackQuery(new RegExp(`^${BUY_PREFIX}`), handleBuyCallback);
}
