/**
 * API client — talks to the KopiX backend under `/api/*`.
 *
 * Auth: `Authorization: TMA <Telegram.WebApp.initData>`
 *   Middleware lives in apps/api/src/middleware/auth.ts.
 *
 * This file exposes the legacy function names the UI was originally written
 * against (postCredentials, getSwapPositions, getClientConfig, …) so the pages
 * don't need to be rewritten. Each adapter maps those calls onto the actual
 * KopiX routes. Where the UI expects a feature that the backend does not yet
 * expose (e.g. live BingX balance, BingX PnL history), the adapter degrades
 * gracefully (empty list / zero) and a TODO is noted in the corresponding
 * section. Replacing those stubs is a backend task, not a UI task.
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

// --- helpers ----------------------------------------------------------------

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

// --- credentials (single BingX connection per subscriber) -------------------
//
// Backend exposes `POST /api/exchange/validate`, which validates the key pair,
// rejects if withdraw is permitted, encrypts, and stores it on the subscriber
// row. There is no multi-broker / named-account concept server-side, so the
// UI's "list of keys" is synthesized as a 0-or-1 item list.

export const BINGX_BROKER_ID =
  "11111111-1111-1111-1111-111111111111" as const;
export const BINGX_BROKER_NAME = "BingX" as const;

export type PostCredentialsBody = {
  name: string;
  apiKey: string;
  apiSecret: string;
  brokerName: string;
  brokerId: string;
  type: "apiKey";
};

export async function postCredentials(
  payload: PostCredentialsBody,
): Promise<{ brokerAccountId: string | null }> {
  const res = await apiRequest("/exchange/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: payload.apiKey, apiSecret: payload.apiSecret }),
  });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  return { brokerAccountId: BINGX_BROKER_ID };
}

export type ApiCredentialListItem = {
  brokerAccountId: string;
  brokerName: string;
  accountLabel: string | null;
  isValid: boolean;
  updatedAt: string;
};

export async function getCredentialsList(): Promise<ApiCredentialListItem[]> {
  const me = await getSubscriberMe();
  if (!me.hasExchangeConnected) return [];
  return [
    {
      brokerAccountId: BINGX_BROKER_ID,
      brokerName: BINGX_BROKER_NAME,
      accountLabel: null,
      isValid: true,
      updatedAt: new Date().toISOString(),
    },
  ];
}

export async function updateCredentials(
  _brokerAccountId: string,
  payload: Omit<PostCredentialsBody, "brokerName" | "brokerId" | "type">,
): Promise<void> {
  // Re-validate overwrites the stored keys server-side (same endpoint).
  await postCredentials({
    ...payload,
    brokerId: BINGX_BROKER_ID,
    brokerName: BINGX_BROKER_NAME,
    type: "apiKey",
  });
}

export async function deleteCredentials(_brokerAccountId: string): Promise<void> {
  // TODO(backend): add DELETE /api/exchange/credentials (zero out
  // apiKeyEncrypted/apiSecretEncrypted on the subscriber row). Until then,
  // disconnect is not supported — surface a clear error to the UI.
  throw new Error("Disconnect is not yet available. Contact support to remove your BingX keys.");
}

// --- subscriber profile / copy settings -------------------------------------

type SubscriberMeResponse = {
  id: string;
  telegramId: string;
  telegramUsername?: string | null;
  copyMode: "fixed" | "percentage";
  fixedAmount: number | null;
  percentage: number | null;
  maxPositionUsdt: number | null;
  status: string;
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

async function getSubscriberMe(): Promise<SubscriberMeResponse> {
  const res = await apiRequest("/subscribers/me", { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  return body as SubscriberMeResponse;
}

// --- subscription (plans + CryptoBot invoice) -------------------------------

export type AccountSubscriptionStatusResponse = {
  success: boolean;
  state?: SubscriptionStatus;
  payUrl?: string | null;
  subscription?: {
    activeTo?: string;
    accountSubscriptionType?: "free" | "standart" | "pro";
    isPaid?: boolean;
  } | null;
};

export type StartSubscriptionPayInput = {
  accountSubscriptionType: "standart" | "pro";
  price?: number;
  currency?: "USDT" | "USD" | "EUR";
  period?: number;
};

export type ClientConfig = {
  subscriptionPrice: number;
};

type PlanDto = {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
};

async function getPlans(): Promise<PlanDto[]> {
  const res = await apiRequest("/plans", { method: "GET" });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  return Array.isArray(body) ? (body as PlanDto[]) : [];
}

export async function getClientConfig(): Promise<ClientConfig> {
  const plans = await getPlans();
  const first = plans[0];
  return { subscriptionPrice: first ? Number(first.price) : 0 };
}

export async function startSubscriptionPayment(
  _payload: StartSubscriptionPayInput,
): Promise<{ payUrl: string | null; invoiceId: string | number | null }> {
  // Backend model is plan-based (not type-based). Pick the cheapest active
  // plan for now; once the UI exposes a plan picker, thread the chosen id in.
  const plans = await getPlans();
  const plan = plans[0];
  if (!plan) throw new Error("No subscription plans are configured");

  const res = await apiRequest("/subscriptions/create-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: plan.id }),
  });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
  const o = asObject(body);
  const payUrl =
    typeof o.miniAppInvoiceUrl === "string"
      ? o.miniAppInvoiceUrl
      : typeof o.botInvoiceUrl === "string"
        ? o.botInvoiceUrl
        : null;
  const invoiceId =
    typeof o.invoiceId === "string" || typeof o.invoiceId === "number"
      ? o.invoiceId
      : null;
  return { payUrl, invoiceId };
}

export async function syncSubscriptionPaymentStatus(): Promise<{
  state: SubscriptionStatus;
  payUrl: string | null;
  activeTo: string | null;
}> {
  // Backend collapses "subscription status" into GET /api/subscribers/me.
  // `active` iff a non-expired subscription row exists; otherwise `inactive`.
  // Distinguishing `payment_pending` would need a separate backend field —
  // not modeled today. `expired` is surfaced by an expiresAt in the past,
  // but the backend filters those out, so we report `inactive`.
  const me = await getSubscriberMe();
  const state: SubscriptionStatus =
    me.subscription && me.subscription.status === "active" ? "active" : "inactive";
  return {
    state,
    payUrl: null,
    activeTo: me.subscription?.expiresAt ?? null,
  };
}

// --- balance / positions / trades / stats -----------------------------------

export async function getBalance(): Promise<number> {
  // TODO(backend): expose GET /api/balance returning current BingX futures
  // balance (engine/exchange already has this call). For now, derive from
  // stats.realizedPnl → not the same as live balance, but > nothing.
  try {
    const res = await apiRequest("/stats", { method: "GET" });
    const body = await parseJson(res);
    if (!res.ok) return 0;
    const o = asObject(body);
    return asNumber(o.realizedPnl, 0);
  } catch {
    return 0;
  }
}

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

export type SwapIncomePoint = {
  timeMs: number;
  income: number;
  asset: string;
};

export async function getSwapPnlHistory(): Promise<SwapIncomePoint[]> {
  // TODO(backend): expose GET /api/pnl-history with per-day BingX income.
  // Dashboard uses this to compute "today's PnL" — returning an empty array
  // makes that widget read 0, which is correct until the endpoint lands.
  return [];
}

// --- copy settings ----------------------------------------------------------

export type UserCopySettings = {
  copyMode: "proportional" | "fixed";
  proportionalPercent: string;
  fixedAmountUsdt: string;
};

export async function getUserCopySettings(): Promise<{
  hasActiveSubscription: boolean;
  settings: UserCopySettings;
}> {
  const me = await getSubscriberMe();
  const hasActiveSubscription =
    !!me.subscription && me.subscription.status === "active";
  if (me.copyMode === "fixed") {
    return {
      hasActiveSubscription,
      settings: {
        copyMode: "fixed",
        proportionalPercent: "10",
        fixedAmountUsdt: String(me.fixedAmount ?? 100),
      },
    };
  }
  return {
    hasActiveSubscription,
    settings: {
      copyMode: "proportional",
      proportionalPercent: String(me.percentage ?? 10),
      fixedAmountUsdt: "100",
    },
  };
}

export async function updateUserCopySettings(input: UserCopySettings): Promise<void> {
  const patchBody =
    input.copyMode === "fixed"
      ? {
          copyMode: "fixed" as const,
          fixedAmount: Math.max(0.01, Number(input.fixedAmountUsdt || "0")),
        }
      : {
          copyMode: "percentage" as const,
          percentage: Math.max(
            0.01,
            Math.min(100, Number(input.proportionalPercent || "0")),
          ),
        };

  const res = await apiRequest("/subscribers/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patchBody),
  });
  const body = await parseJson(res);
  if (!res.ok) throw new Error(errorMessageFromBody(body, res.status));
}
