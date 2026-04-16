export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  hasTradePermission: boolean;
  hasWithdrawPermission: boolean;
  futuresBalance?: number;
}

export interface Balance {
  total: number;
  available: number;
  currency: string;
}

export interface OrderParams {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  positionSide: "LONG" | "SHORT";
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  executedPrice: number;
  executedAmount: number;
  status: string;
  rawResponse: unknown;
}
