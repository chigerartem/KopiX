/**
 * Rate-limited Telegram sender.
 *
 * Telegram limits a bot to:
 *   - 30 messages per second globally
 *   - 1 message per second per individual chat
 *
 * At 5000 active subscribers, a single master trade burst can produce
 * thousands of `sendMessage` calls in milliseconds. Without throttling,
 * Telegram replies with 429 errors and the bot's downstream code spins.
 *
 * This module wraps `bot.api.sendMessage` with:
 *   1. A global token bucket at 25 msg/s (safety margin under 30)
 *   2. A per-chat last-send-time gate (≥1100ms between messages to the
 *      same chat)
 *
 * Failures are not retried — caller decides; trade notifications are
 * best-effort UX and a missed one is acceptable.
 *
 * In-memory (lost on restart) by design — for at-least-once delivery the
 * caller should drive from a durable Redis stream, not this queue.
 */

import type { Bot } from "grammy";
import { logger } from "../logger.js";

// Loose alias — grammY's Other<RawApi, "sendMessage", ...> isn't exported in
// recent versions; the API accepts any plain options object.
type SendMessageOptions = Parameters<Bot["api"]["sendMessage"]>[2];

const GLOBAL_RPS = Number(process.env["TG_GLOBAL_RPS"] ?? 25);
const GLOBAL_BURST = Number(process.env["TG_GLOBAL_BURST"] ?? 25);
const PER_CHAT_INTERVAL_MS = Number(process.env["TG_PER_CHAT_INTERVAL_MS"] ?? 1100);

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const globalBucket: Bucket = { tokens: GLOBAL_BURST, lastRefill: Date.now() };
const lastChatSendAt = new Map<number, number>();

function refill(b: Bucket, now: number): void {
  const elapsedSec = (now - b.lastRefill) / 1000;
  if (elapsedSec <= 0) return;
  b.tokens = Math.min(GLOBAL_BURST, b.tokens + elapsedSec * GLOBAL_RPS);
  b.lastRefill = now;
}

async function acquireGlobal(): Promise<void> {
  for (;;) {
    refill(globalBucket, Date.now());
    if (globalBucket.tokens >= 1) {
      globalBucket.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - globalBucket.tokens) / GLOBAL_RPS) * 1000);
    await sleep(Math.max(waitMs, 5));
  }
}

async function acquirePerChat(chatId: number): Promise<void> {
  const last = lastChatSendAt.get(chatId) ?? 0;
  const since = Date.now() - last;
  if (since < PER_CHAT_INTERVAL_MS) {
    await sleep(PER_CHAT_INTERVAL_MS - since);
  }
  lastChatSendAt.set(chatId, Date.now());
}

/**
 * Send a message respecting both Telegram global and per-chat limits.
 * Resolves with the underlying grammY result, or rejects with whatever
 * grammY threw (caller decides whether to ignore 403/blocked).
 */
export async function sendMessageThrottled(
  bot: Bot,
  chatId: number,
  text: string,
  options?: SendMessageOptions,
): Promise<unknown> {
  await acquirePerChat(chatId);
  await acquireGlobal();
  return bot.api.sendMessage(chatId, text, options);
}

/** Periodic GC for the per-chat map so it doesn't grow unbounded. */
export function pruneStaleChatRecords(idleMs = 60 * 60 * 1000): void {
  const cutoff = Date.now() - idleMs;
  for (const [k, v] of lastChatSendAt) {
    if (v < cutoff) lastChatSendAt.delete(k);
  }
}

/** Boot the GC interval (called once at bot startup). */
export function startThrottleMaintenance(): void {
  setInterval(() => pruneStaleChatRecords(), 15 * 60 * 1000);
  logger.info({ event: "throttledSender.maintenance_started" }, "Telegram throttle GC running");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
