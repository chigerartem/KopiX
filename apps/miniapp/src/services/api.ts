/**
 * API client — talks to the KopiX backend under `/api/*`.
 *
 * Auth: `Authorization: TMA <Telegram.WebApp.initData>`
 *   Middleware lives in apps/api/src/middleware/auth.ts.
 *
 * The miniapp is a read-only dashboard:
 *   - Balance, open positions, closed trades, PnL history
 *   - Subscription status (read-only)
 *
 * API key connection   → /connect in the bot
 * Copy settings        → /mode in the bot
 * Subscription purchase → /subscribe in the bot
 */
import type { OpenTradePosition } from "@/types/trade";
import type { SubscriptionStatus } from "@/types/app";
import { getTelegramWebApp } from "@/services/telegram";

const BASE_URL = (
  (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env
    ?.VITE_API_URL || "/api"
).replace(/\/$/, "");

function readTelegramInitData(): string | null {
  const tg = getTelegramWebApp();
  const initData = tg?.initData?.trim();
  return initData ? initData : null;
}

export function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  const p = path.startsWith("/") ? path : `/${path}`;
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const initData = readTelegramInitData();
  if (!initData) throw new Error("Telegram initData is missing");
  headers.set("Authorization", `TMA ${initData}`);

  return fetch(`${BASE_URL}${p}`, { ...init, headers });
}

// ── helpers ──────────────────────────────────────────────────────────────────

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toPair(symbolLike: unknown): string {
  const raw = String(symbolLike ?? "").trim();
  if (!raw) return "UNKNOWN/USDT";
  if (raw.includes("/")) return raw.toUpperCase();
  if (raw.includes("-")) return raw.replace("-", "/").toUpperCase();
  if (raw.endsWith("USDT")) return `${raw.slice(0, -4).toUpperCase()}/USDT`;
  return raw.toUpperCase();
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessageFromBody(body: unknown, status: number): string {
  const o = asObject(body);
  if (typeof o.error === "string") return o.error;
  if (typeof o.message === "string") return o.message;
  return `HTTP ${status}`;
}

// ── balance ───────────────────────────────────────────────────────────────────

export async function getBalance(): Promise<number> {
  try {
    const res = await apiRequest("/exchange/balance", { method: "GET" });
    if (!res.ok) return 0;
    const body = await parseJson(res);
    const o = asObject(body);
    return asNumber(o.available, 0);
  } catch {
    return 0;
  }
}

// ── positions ─────────────────────────────────────────────────────────────────

type PositionDto = {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  size: number;
  openedAt: string;
};

export async function getSwapPositions(): Promise<OpenTradePosition[]> {
  const res = await apiRequest("/positions", { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  const rows = Array.isArray(body) ? (body as PositionDto[]) : [];
  return rows.map((r) => {
    const sideRaw = String(r.side ?? "").toUpperCase();
    const side: "LONG" | "SHORT" =
      sideRaw.includes("SHORT") || sideRaw.includes("SELL") ? "SHORT" : "LONG";
    const entry = asNumber(r.entryPrice, 0);
    const size = asNumber(r.size, 0);
    return {
      id: String(r.id),
      pair: toPair(r.symbol),
      side,
      leverage: 1,
      sizeUsdt: Math.abs(size * entry),
      entryPrice: entry,
      currentPrice: entry,
      pnlUsd: 0,
      pnlPct: 0,
      openedAt: r.openedAt,
      status: "open",
    };
  });
}

// ── trades ────────────────────────────────────────────────────────────────────

type TradeDto = {
  id: string;
  symbol: string;
  side: string;
  tradeType: string;
  orderedSize: number;
  executedSize: number | null;
  executedPrice: number | null;
  masterPrice: number;
  slippagePct: number | null;
  status: string;
  failureReason: string | null;
  executedAt: string | null;
  createdAt: string;
};

export async function getSwapClosedTrades(): Promise<OpenTradePosition[]> {
  const res = await apiRequest("/trades?limit=50", { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  const root = asObject(body);
  const items = Array.isArray(root.items) ? (root.items as TradeDto[]) : [];
  return items
    .filter((t) => t.status === "filled" && t.executedPrice != null)
    .map((t) => {
      const price = asNumber(t.executedPrice, 0);
      const size = asNumber(t.executedSize, 0);
      const sideRaw = String(t.side ?? "").toUpperCase();
      const side: "LONG" | "SHORT" = sideRaw.includes("SELL") ? "SHORT" : "LONG";
      return {
        id: t.id,
        pair: toPair(t.symbol),
        side,
        leverage: 1,
        sizeUsdt: Math.abs(size * price),
        entryPrice: price,
        currentPrice: price,
        pnlUsd: 0,
        pnlPct: 0,
        openedAt: t.executedAt ?? t.createdAt,
        status: "closed",
      };
    });
}

// ── PnL history ───────────────────────────────────────────────────────────────

export type SwapIncomePoint = {
  timeMs: number;
  income: number;
  asset: string;
};

export async function getSwapPnlHistory(): Promise<SwapIncomePoint[]> {
  const res = await apiRequest("/pnl-history?days=30", { method: "GET" });
  if (!res.ok) return [];
  const body = await parseJson(res);
  const rows = Array.isArray(body)
    ? (body as Array<{ date: string; realizedPnl: number | string }>)
    : [];
  return rows.map((r) => ({
    timeMs: new Date(r.date).getTime(),
    income: asNumber(r.realizedPnl, 0),
    asset: "USDT",
  }));
}

// ── subscription status (read-only) ──────────────────────────────────────────

type SubscriberMeResponse = {
  subscription: {
    status: string;
    expiresAt: string;
  } | null;
};

async function getSubscriberMe(): Promise<SubscriberMeResponse> {
  const res = await apiRequest("/subscribers/me", { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  return body as SubscriberMeResponse;
}

export async function syncSubscriptionPaymentStatus(): Promise<{
  state: SubscriptionStatus;
  payUrl: string | null;
  activeTo: string | null;
}> {
  const me = await getSubscriberMe();
  const state: SubscriptionStatus =
    me.subscription && me.subscription.status === "active" ? "active" : "inactive";
  return {
    state,
    payUrl: null,
    activeTo: me.subscription?.expiresAt ?? null,
  };
}
