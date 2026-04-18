import type { Bot } from "grammy";
import { handleStart } from "./start.js";
import { registerConnectHandlers } from "./connect.js";
import { registerSubscribeHandlers } from "./subscribe.js";
import { handleStatus } from "./status.js";
import { registerModeHandlers } from "./mode.js";
import { registerPauseResumeHandlers } from "./pause_resume.js";
import { handleDashboard } from "./dashboard.js";

export function registerHandlers(bot: Bot): void {
  bot.command("start", handleStart);
  registerConnectHandlers(bot);
  registerSubscribeHandlers(bot);
  bot.command("status", handleStatus);
  registerModeHandlers(bot);
  registerPauseResumeHandlers(bot);
  bot.command("dashboard", handleDashboard);
}
