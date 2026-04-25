import type { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";

export async function handleDashboard(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("⚠️ /dashboard only works in a private chat with the bot.");
    return;
  }

  if (!config.miniAppUrl) {
    await ctx.reply("Dashboard is not configured — operator must set MINIAPP_URL.");
    return;
  }

  const kb = new InlineKeyboard().webApp("Open dashboard 📊", config.miniAppUrl);

  await ctx.reply("Open the KopiX Mini App:", { reply_markup: kb });
}
