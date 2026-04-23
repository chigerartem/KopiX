import type { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";

export async function handleDashboard(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ Команда /dashboard работает только в личном чате с ботом.");
    return;
  }

  if (!config.miniAppUrl) {
    await ctx.reply(
      "Дашборд пока недоступен — оператор не настроил MINIAPP_URL.",
    );
    return;
  }

  const kb = new InlineKeyboard().webApp("Открыть дашборд 📊", config.miniAppUrl);

  await ctx.reply("Откройте мини-приложение KopiX:", { reply_markup: kb });
}
