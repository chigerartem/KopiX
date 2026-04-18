export interface SubscriberProfile {
  id: string;
  telegramId: string;
  telegramUsername: string | null;
  copyMode: "fixed" | "percentage" | null;
  fixedAmount: number | null;
  percentage: number | null;
  maxPositionUsdt: number | null;
  status: "active" | "paused" | "inactive" | "suspended";
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
}

export interface Stats {
  totalTrades: number;
  filledTrades: number;
  failedTrades: number;
  skippedTrades: number;
  realizedPnl: number;
  winRate: number | null;
}

export interface TradeItem {
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
}

export interface TradeList {
  total: number;
  limit: number;
  offset: number;
  items: TradeItem[];
}

export interface OpenPosition {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  size: number;
  openedAt: string;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
}

export interface InvoiceResult {
  invoiceId: number;
  miniAppInvoiceUrl: string;
  botInvoiceUrl: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown
  ) {
    super(`API error ${status}`);
  }
}

export function createApi(initData: string) {
  const base = import.meta.env.VITE_API_URL ?? "";

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `TMA ${initData}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const data: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      throw new ApiError(res.status, data);
    }

    return data as T;
  }

  return {
    getProfile: () => request<SubscriberProfile>("GET", "/api/subscribers/me"),

    updateProfile: (
      patch: Partial<
        Pick<
          SubscriberProfile,
          "copyMode" | "fixedAmount" | "percentage" | "maxPositionUsdt"
        > & { action?: "pause" | "resume" }
      >
    ) => request<SubscriberProfile>("PATCH", "/api/subscribers/me", patch),

    validateExchange: (payload: { apiKey: string; apiSecret: string }) =>
      request<{ connected: boolean; futuresBalance: number }>(
        "POST",
        "/api/exchange/validate",
        payload
      ),

    getPlans: () => request<Plan[]>("GET", "/api/plans"),

    createInvoice: (planId: string) =>
      request<InvoiceResult>("POST", "/api/subscriptions/create-invoice", {
        planId,
      }),

    getTrades: (params: { limit: number; offset: number }) =>
      request<TradeList>(
        "GET",
        `/api/trades?limit=${params.limit}&offset=${params.offset}`
      ),

    getStats: () => request<Stats>("GET", "/api/stats"),
  };
}
