/**
 * Trade notifier — bridges engine trade events into Telegram messages.
 *
 * The engine publishes one JSON event per fill on Redis channel
 * `trades:{subscriberId}` (apps/engine/src/engine/subscriberExecutor.ts).
 * We psubscribe to `trades:*` with a dedicated Redis client (pub/sub
 * connections cannot share with command clients), look up the
 * subscriber's `telegramId`, and send a formatted notification.
 *
 * Open vs close branches on `data.tradeType`. For close events we try to
 * surface realized PnL by reading the most recently closed Position row
 * for that subscriber+symbol — if missing, we fall back to "—".
 *
 * Failures are swallowed: a bot blocked by the user (HTTP 403), a deleted
 * chat, or a transient Telegram error must NOT crash the notifier loop.
 */

import { Redis } from "ioredis";
import type { Bot } from "grammy";
import { GrammyError } from "grammy";
import { logger } from "../logger.js";
import { prisma } from "../prisma.js";

type TradeEventData = {
  id: string;
  signalId: string;
  symbol: string;
  side: string; // OrderSide: "buy" | "sell"
  tradeType: "open" | "close" | "increase" | "decrease";
  executedSize: number;
  executedPrice: number;
  masterPrice: number;
  slippagePct: number | null;
  orderId: string | null;
  executedAt: string;
};

type TradeEvent = {
  type: "trade_executed";
  data: TradeEventData;
};

const telegramIdCache = new Map<string, bigint>();

async function resolveTelegramId(subscriberId: string): Promise<bigint | null> {
  const cached = telegramIdCache.get(subscriberId);
  if (cached !== undefined) return cached;
  const row = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { telegramId: true },
  });
  if (!row) return null;
  telegramIdCache.set(subscriberId, row.telegramId);
  return row.telegramId;
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPrice(n: number): string {
  // Choose precision based on magnitude (BTC vs micro-cap)
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
  } catch {
    return iso;
  }
}

function pairLabel(symbol: string): string {
  const raw = String(symbol ?? "").trim();
  if (!raw) return "?";
  if (raw.includes("/")) return raw.toUpperCase();
  if (raw.includes("-")) return raw.replace("-", "/").toUpperCase();
  if (raw.endsWith("USDT")) return `${raw.slice(0, -4).toUpperCase()}/USDT`;
  return raw.toUpperCase();
}

/**
 * Resolve display direction from order side + tradeType.
 * - open/increase: buy → LONG, sell → SHORT
 * - close/decrease: sell → LONG (selling closes/reduces a long), buy → SHORT
 */
function resolveDirection(
  side: string,
  tradeType: TradeEventData["tradeType"],
): "LONG" | "SHORT" {
  const isBuy = side.toLowerCase() === "buy";
  const closing = tradeType === "close" || tradeType === "decrease";
  if (closing) return isBuy ? "SHORT" : "LONG";
  return isBuy ? "LONG" : "SHORT";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function fetchClosedPnl(
  subscriberId: string,
  symbol: string,
): Promise<{ realizedPnl: number | null; entryPrice: number | null } | null> {
  try {
    const pos = await prisma.position.findFirst({
      where: { subscriberId, symbol, status: "closed" },
      orderBy: { closedAt: "desc" },
      select: { realizedPnl: true, entryPrice: true },
    });
    if (!pos) return null;
    return {
      realizedPnl: pos.realizedPnl == null ? null : Number(pos.realizedPnl),
      entryPrice: pos.entryPrice == null ? null : Number(pos.entryPrice),
    };
  } catch (err) {
    logger.warn(
      { event: "tradeNotifier.pnl_lookup_failed", err: String(err) },
      "Failed to read closed position for PnL",
    );
    return null;
  }
}

function formatOpenMessage(d: TradeEventData): string {
  const dir = resolveDirection(d.side, d.tradeType);
  const pair = pairLabel(d.symbol);
  const notional = d.executedSize * d.executedPrice;
  const verb = d.tradeType === "increase" ? "Position increased" : "Trade opened";
  const lines = [
    `📈 <b>${escapeHtml(verb)}</b>`,
    `<b>${escapeHtml(pair)} · ${dir}</b>`,
    `Size: ${formatNumber(notional)} USDT`,
    `Entry: ${formatPrice(d.executedPrice)}`,
    `Master price: ${formatPrice(d.masterPrice)}`,
  ];
  if (d.slippagePct != null && Number.isFinite(d.slippagePct)) {
    lines.push(`Slippage: ${formatNumber(d.slippagePct, 2)}%`);
  }
  lines.push(`<i>${escapeHtml(formatTimestamp(d.executedAt))}</i>`);
  return lines.join("\n");
}

async function formatCloseMessage(
  d: TradeEventData,
  subscriberId: string,
): Promise<string> {
  const dir = resolveDirection(d.side, d.tradeType);
  const pair = pairLabel(d.symbol);
  const verb = d.tradeType === "decrease" ? "Position reduced" : "Trade closed";

  const closed = await fetchClosedPnl(subscriberId, d.symbol);
  let pnlLine = "PnL: —";
  if (closed?.realizedPnl != null) {
    const pnl = closed.realizedPnl;
    const sign = pnl >= 0 ? "+" : "";
    let pctText = "";
    if (closed.entryPrice && closed.entryPrice > 0 && d.executedSize > 0) {
      const notional = closed.entryPrice * d.executedSize;
      if (notional > 0) {
        const pct = (pnl / notional) * 100;
        pctText = ` (${pnl >= 0 ? "+" : ""}${formatNumber(pct, 2)}%)`;
      }
    }
    pnlLine = `PnL: <b>${sign}${formatNumber(pnl, 2)} USDT</b>${pctText}`;
  }

  const lines = [
    `✅ <b>${escapeHtml(verb)}</b>`,
    `<b>${escapeHtml(pair)} · ${dir}</b>`,
    `Exit: ${formatPrice(d.executedPrice)}`,
    pnlLine,
    `<i>${escapeHtml(formatTimestamp(d.executedAt))}</i>`,
  ];
  return lines.join("\n");
}

function parseEvent(payload: string): TradeEvent | null {
  try {
    const obj = JSON.parse(payload) as unknown;
    if (
      !obj ||
      typeof obj !== "object" ||
      (obj as { type?: unknown }).type !== "trade_executed"
    ) {
      return null;
    }
    const data = (obj as { data?: unknown }).data;
    if (!data || typeof data !== "object") return null;
    return obj as TradeEvent;
  } catch {
    return null;
  }
}

export async function startTradeNotifier(bot: Bot): Promise<void> {
  const url = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
  const sub = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: null, // pub/sub clients should keep retrying
  });

  sub.on("error", (err: Error) => {
    logger.error(
      { event: "tradeNotifier.redis_error", err: err.message },
      "Trade notifier Redis error",
    );
  });

  sub.on("pmessage", (_pattern: string, channel: string, message: string) => {
    void handleMessage(bot, channel, message);
  });

  await sub.psubscribe("trades:*");
  logger.info(
    { event: "tradeNotifier.started" },
    "Trade notifier subscribed to trades:*",
  );
}

async function handleMessage(
  bot: Bot,
  channel: string,
  message: string,
): Promise<void> {
  const subscriberId = channel.startsWith("trades:")
    ? channel.slice("trades:".length)
    : "";
  if (!subscriberId) return;

  const event = parseEvent(message);
  if (!event) {
    logger.warn(
      { event: "tradeNotifier.parse_failed", channel },
      "Could not parse trade event",
    );
    return;
  }

  const telegramId = await resolveTelegramId(subscriberId);
  if (!telegramId) {
    logger.warn(
      { event: "tradeNotifier.no_subscriber", subscriberId },
      "No subscriber row for trade event",
    );
    return;
  }

  let text: string;
  if (event.data.tradeType === "close" || event.data.tradeType === "decrease") {
    text = await formatCloseMessage(event.data, subscriberId);
  } else {
    text = formatOpenMessage(event.data);
  }

  try {
    await bot.api.sendMessage(Number(telegramId), text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (err: unknown) {
    if (err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400)) {
      logger.warn(
        {
          event: "tradeNotifier.send_skipped",
          subscriberId,
          telegramErrorCode: err.error_code,
        },
        "Could not send trade notification (chat unavailable)",
      );
      return;
    }
    logger.error(
      { event: "tradeNotifier.send_failed", subscriberId, err: String(err) },
      "Failed to send trade notification",
    );
  }
}
