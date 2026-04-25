/**
 * /status — subscriber status summary (read-only).
 *
 * Shows the subscriber state, active subscription, BingX connection state
 * and copy mode. All mutations (connect, pick plan, change copy mode) are
 * performed in the Mini App, so this handler is purely informational.
 */

import { InlineKeyboard, type CommandContext, type Context } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";
import { config } from "../config.js";

const STATUS_LABELS: Record<string, string> = {
  active: "🟢 Active — copying enabled",
  paused: "⏸ Paused — no new trades will be copied",
  inactive: "⚪ Inactive — connect BingX and pick a plan in the Mini App",
  suspended: "🔴 Suspended — contact support",
};

export async function handleStatus(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ /status only works in a private chat with the bot.");
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
    await ctx.reply("You're not registered yet. Send /start to begin.");
    return;
  }

  const lines: string[] = [];

  lines.push(STATUS_LABELS[subscriber.status] ?? subscriber.status);
  lines.push("");

  const sub = subscriber.subscriptions[0];
  if (sub) {
    const daysLeft = Math.max(
      0,
      Math.ceil((sub.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    lines.push(`📅 Subscription: *${sub.plan.name}*`);
    lines.push(`   Expires: ${sub.expiresAt.toISOString().slice(0, 10)} (in ${daysLeft} day${daysLeft === 1 ? "" : "s"})`);
  } else {
    lines.push("📅 Subscription: none — pick a plan in the Mini App");
  }
  lines.push("");

  const hasKeys = !!(subscriber.apiKeyEncrypted && subscriber.apiSecretEncrypted);
  lines.push(
    hasKeys
      ? "🔐 BingX: connected"
      : "🔐 BingX: not connected — add a trade-only key in the Mini App",
  );
  lines.push("");

  if (subscriber.copyMode === "fixed") {
    const amount = subscriber.fixedAmount?.toString() ?? "?";
    lines.push(`⚙️ Copy mode: fixed ${amount} USDT per trade`);
  } else if (subscriber.copyMode === "percentage") {
    const pct = subscriber.percentage?.toString() ?? "?";
    lines.push(`⚙️ Copy mode: ${pct}% of master position`);
  } else {
    lines.push("⚙️ Copy mode: not configured — set in the Mini App");
  }

  if (subscriber.maxPositionUsdt) {
    lines.push(`   Max position cap: ${subscriber.maxPositionUsdt.toString()} USDT`);
  }

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

  const keyboard = config.miniAppUrl
    ? new InlineKeyboard().webApp("Open Mini App", config.miniAppUrl)
    : undefined;

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}
