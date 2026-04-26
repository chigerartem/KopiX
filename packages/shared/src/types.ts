import type { SignalType, OrderSide, CopyMode, SubscriberStatus, SubscriptionStatus } from "./enums.js";

export interface TradeSignal {
  id: string;
  symbol: string;
  side: OrderSide;
  signalType: SignalType;
  masterPrice: number;
  masterSize: number;
  masterPositionId: string;
  timestamp: number;
  streamId?: string;
  /**
   * Correlation ID — assigned at signal normalization, propagates through
   * Redis stream, executor, position writes, and downstream notification
   * pubsub. Lets a single grep stitch every action triggered by one master
   * trade across all services.
   */
  correlationId?: string;
}

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export interface SubscriberConfig {
  id: string;
  copyMode: CopyMode;
  fixedAmount: number | null;
  percentage: number | null;
  maxPositionUsdt: number | null;
  status: SubscriberStatus;
}

export interface SubscriptionInfo {
  id: string;
  status: SubscriptionStatus;
  startedAt: Date;
  expiresAt: Date;
  planName: string;
  amountPaid: number;
  currency: string;
}

export interface PlanDto {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
}

export interface SubscriberProfileDto {
  id: string;
  telegramId: number;
  telegramUsername: string | null;
  copyMode: CopyMode | null;
  fixedAmount: number | null;
  percentage: number | null;
  maxPositionUsdt: number | null;
  status: SubscriberStatus;
  hasExchangeConnected: boolean;
  subscription: SubscriptionInfo | null;
}

export interface TradeHistoryItemDto {
  id: string;
  symbol: string;
  side: OrderSide;
  signalType: SignalType;
  orderedSize: number;
  executedSize: number | null;
  executedPrice: number | null;
  masterPrice: number;
  slippagePct: number | null;
  status: string;
  failureReason: string | null;
  executedAt: Date | null;
  createdAt: Date;
}

export interface OpenPositionDto {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  size: number;
  openedAt: Date;
}

export interface StatsDto {
  totalTrades: number;
  filledTrades: number;
  failedTrades: number;
  skippedTrades: number;
  realizedPnl: number;
  winRate: number | null;
}

export interface SseTradeEvent {
  type: "trade_executed" | "position_closed" | "subscription_expired";
  data: Record<string, unknown>;
}
