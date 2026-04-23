/**
 * /status — subscriber status summary (architecture §13.2).
 *
 * Shows:
 *   - Subscriber state (active / paused / inactive / suspended) with a
 *     plain-language explanation of what it means for copy-trading.
 *   - Current active subscription and days remaining (or "нет подписки").
 *   - Copy mode + parameters (fixed amount / percentage / max position cap).
 *   - Whether BingX keys are connected.
 *
 * Purely read-only. Safe to call from any private chat at any time.
 */

import type { CommandContext, Context } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";

const STATUS_LABELS: Record<string, string> = {
  active: "🟢 Активен — копирование включено",
  paused: "⏸ На паузе — новые сделки не открываются",
  inactive: "⚪ Неактивен — подключите BingX и выберите подписку",
  suspended: "🔴 Заблокирован — свяжитесь с поддержкой",
};

export async function handleStatus(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ Команда /status работает только в личном чате с ботом.");
    return;
  }
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);

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

  if (!subscriber) {
    await ctx.reply("Вы ещё не зарегистрированы. Отправьте /start, чтобы начать.");
    return;
  }

  const lines: string[] = [];

  lines.push(STATUS_LABELS[subscriber.status] ?? subscriber.status);
  lines.push("");

  // Subscription
  const sub = subscriber.subscriptions[0];
  if (sub) {
    const daysLeft = Math.max(
      0,
      Math.ceil((sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    lines.push(`📅 Подписка: *${sub.plan.name}*`);
    lines.push(`   Истекает: ${sub.expiresAt.toISOString().slice(0, 10)} (через ${daysLeft} дн.)`);
  } else {
    lines.push("📅 Подписка: отсутствует — /subscribe, чтобы выбрать план");
  }
  lines.push("");

  // BingX keys
  const hasKeys = !!(subscriber.apiKeyEncrypted && subscriber.apiSecretEncrypted);
  lines.push(
    hasKeys
      ? "🔐 BingX: подключён"
      : "🔐 BingX: не подключён — /connect, чтобы добавить API-ключи",
  );
  lines.push("");

  // Copy mode
  if (subscriber.copyMode === "fixed") {
    const amount = subscriber.fixedAmount?.toString() ?? "?";
    lines.push(`⚙️ Режим копирования: фикс. сумма ${amount} USDT на сделку`);
  } else if (subscriber.copyMode === "percentage") {
    const pct = subscriber.percentage?.toString() ?? "?";
    lines.push(`⚙️ Режим копирования: ${pct}% от позиции мастера`);
  } else {
    lines.push("⚙️ Режим копирования: не настроен — /mode");
  }

  if (subscriber.maxPositionUsdt) {
    lines.push(`   Лимит на позицию: ${subscriber.maxPositionUsdt.toString()} USDT`);
  }

  // Quick actions footer
  lines.push("");
  lines.push("Команды: /mode  /pause  /resume  /dashboard");

  logger.info(
    {
      event: "bot.status.view",
      telegramId: ctx.from.id,
      subscriberStatus: subscriber.status,
      hasKeys,
      hasActiveSub: !!sub,
    },
    "Showed status",
  );

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}
