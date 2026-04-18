/**
 * Command registration for the grammY Bot.
 * Keep this file thin — each command lives in its own module.
 */

import type { Bot } from "grammy";
import { handleStart } from "./start.js";
import { registerConnectHandlers } from "./connect.js";

export function registerHandlers(bot: Bot): void {
  bot.command("start", handleStart);
  registerConnectHandlers(bot);
}
