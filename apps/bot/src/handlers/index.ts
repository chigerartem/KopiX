import type { Bot } from "grammy";
import { handleStart } from "./start.js";
import { handleStatus } from "./status.js";
import { registerPauseResumeHandlers } from "./pause_resume.js";
import { handleDashboard } from "./dashboard.js";

export function registerHandlers(bot: Bot): void {
  bot.command("start", handleStart);
  bot.command("status", handleStatus);
  registerPauseResumeHandlers(bot);
  bot.command("dashboard", handleDashboard);
}
