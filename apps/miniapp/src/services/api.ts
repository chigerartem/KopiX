/**
 * API client — talks to the KopiX backend under `/api/*`.
 *
 * Auth: `Authorization: TMA <Telegram.WebApp.initData>`
 *   Middleware lives in apps/api/src/middleware/auth.ts.
 *
 * The miniapp owns ALL interactive flows:
 *   - Dashboard (balance, positions, closed trades, PnL history)
 *   - API key connection (validate + delete)
 *   - Copy settings (mode, sizing, pause/resume)
 *   - Subscription purchase (CryptoBot invoice)
 *
 * The bot is read-only — it shows app description and pushes trade notifications.
 */
import type { OpenTradePosition } from "@/types/trade";
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

// ── subscriber profile (single source of truth for settings + status) ───────

export type SubscriberMe = {
  id: string;
  telegramId: string;
  telegramUsername: string | null;
  copyMode: "fixed" | "percentage";
  fixedAmount: number | null;
  percentage: number | null;
  maxPositionUsdt: number | null;
  status: "active" | "inactive" | "paused";
  hasExchangeConnected: boolean;
  subscription: {
    id: string;
    status: string;
    startedAt: string;
    expiresAt: string;
    planName: string;
    amountPaid: number;
    currency: string;
  } | null;
};

export async function getSubscriberMe(): Promise<SubscriberMe> {
  const res = await apiRequest("/subscribers/me", { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  const o = asObject(body);
  const sub = asObject(o.subscription);
  const hasSub = o.subscription != null;
  return {
    id: String(o.id ?? ""),
    telegramId: String(o.telegramId ?? ""),
    telegramUsername: typeof o.telegramUsername === "string" ? o.telegramUsername : null,
    copyMode: (o.copyMode === "percentage" ? "percentage" : "fixed"),
    fixedAmount: o.fixedAmount == null ? null : asNumber(o.fixedAmount, 0),
    percentage: o.percentage == null ? null : asNumber(o.percentage, 0),
    maxPositionUsdt: o.maxPositionUsdt == null ? null : asNumber(o.maxPositionUsdt, 0),
    status: (o.status === "active" || o.status === "paused" ? o.status : "inactive") as SubscriberMe["status"],
    hasExchangeConnected: Boolean(o.hasExchangeConnected),
    subscription: hasSub
      ? {
          id: String(sub.id ?? ""),
          status: String(sub.status ?? ""),
          startedAt: String(sub.startedAt ?? ""),
          expiresAt: String(sub.expiresAt ?? ""),
          planName: String(sub.planName ?? ""),
          amountPaid: asNumber(sub.amountPaid, 0),
          currency: String(sub.currency ?? "USDT"),
        }
      : null,
  };
}

export type SubscriberPatch = {
  copyMode?: "fixed" | "percentage";
  fixedAmount?: number;
  percentage?: number;
  maxPositionUsdt?: number | null;
  action?: "pause" | "resume";
};

export async function patchSubscriberMe(patch: SubscriberPatch): Promise<void> {
  const res = await apiRequest("/subscribers/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await parseJson(res);
    throw new Error(errorMessageFromBody(body, res.status));
  }
}

// ── BingX credentials ────────────────────────────────────────────────────────

export type ExchangeValidateResult = {
  ok: boolean;
  hasWithdrawPermission: boolean;
  futuresBalance: number | null;
  error: string | null;
};

export async function postExchangeValidate(
  apiKey: string,
  apiSecret: string,
): Promise<ExchangeValidateResult> {
  const res = await apiRequest("/exchange/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, apiSecret }),
  });
  const body = await parseJson(res);
  const o = asObject(body);
  if (!res.ok) {
    return {
      ok: false,
      hasWithdrawPermission: Boolean(o.hasWithdrawPermission),
      futuresBalance: null,
      error: errorMessageFromBody(body, res.status),
    };
  }
  return {
    ok: true,
    hasWithdrawPermission: Boolean(o.hasWithdrawPermission),
    futuresBalance: o.futuresBalance == null ? null : asNumber(o.futuresBalance, 0),
    error: null,
  };
}

export async function deleteExchangeCredentials(): Promise<void> {
  const res = await apiRequest("/exchange/credentials", { method: "DELETE" });
  if (!res.ok) {
    const body = await parseJson(res);
    throw new Error(errorMessageFromBody(body, res.status));
  }
}

// ── plans + subscription invoice ─────────────────────────────────────────────

export type Plan = {
  id: string;
  name: string;
  durationDays: number;
  priceUsdt: number;
};

export async function getPlans(): Promise<Plan[]> {
  const res = await apiRequest("/plans", { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  const rows = Array.isArray(body) ? (body as JsonObject[]) : [];
  return rows.map((r) => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    durationDays: asNumber(r.durationDays, 0),
    priceUsdt: asNumber(r.priceUsdt, 0),
  }));
}

export type SubscriptionInvoice = {
  invoiceId: string;
  botInvoiceUrl: string;
  miniAppInvoiceUrl: string | null;
};

export async function createSubscriptionInvoice(planId: string): Promise<SubscriptionInvoice> {
  const res = await apiRequest("/subscriptions/create-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId }),
  });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  const o = asObject(body);
  return {
    invoiceId: String(o.invoiceId ?? ""),
    botInvoiceUrl: String(o.botInvoiceUrl ?? ""),
    miniAppInvoiceUrl:
      typeof o.miniAppInvoiceUrl === "string" ? o.miniAppInvoiceUrl : null,
  };
}
