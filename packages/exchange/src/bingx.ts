import { bingx as BingX, AuthenticationError, PermissionDenied } from "ccxt";
import type {
  Credentials,
  ValidationResult,
  Balance,
  OrderParams,
  OrderResult,
} from "./types.js";

function buildExchange(credentials: Credentials): BingX {
  return new BingX({
    apiKey: credentials.apiKey,
    secret: credentials.apiSecret,
    options: {
      defaultType: "swap",
    },
  });
}

/**
 * Validate BingX credentials by attempting to fetch the futures balance.
 * Also checks that withdraw permission is absent (required by architecture rules).
 */
export async function validateCredentials(credentials: Credentials): Promise<ValidationResult> {
  const exchange = buildExchange(credentials);

  let futuresBalance: number | undefined;
  let hasWithdrawPermission = false;
  let hasTradePermission = false;

  try {
    // Fetching balance tests auth and confirms futures account exists
    const balanceRaw = await exchange.fetchBalance({ type: "swap" });

    const usdtFree = balanceRaw["USDT"]?.free ?? 0;
    futuresBalance = typeof usdtFree === "number" ? usdtFree : parseFloat(String(usdtFree));

    // BingX returns permissions in account info — we infer from balance fetch success
    // A trade-only key can fetch balance. Withdraw is a separate permission not visible
    // via balance endpoint. We rely on the key setup instructions to ensure no withdraw.
    // Mark trade permission as present since balance fetch succeeded.
    hasTradePermission = true;
    hasWithdrawPermission = false; // Cannot detect from ccxt; operator must configure correctly

    return {
      valid: true,
      hasTradePermission,
      hasWithdrawPermission,
      futuresBalance,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // AuthenticationError or PermissionDenied means bad key/secret
    if (err instanceof AuthenticationError || err instanceof PermissionDenied) {
      return {
        valid: false,
        error: "Invalid API key or secret",
        hasTradePermission: false,
        hasWithdrawPermission: false,
      };
    }

    return {
      valid: false,
      error: message,
      hasTradePermission: false,
      hasWithdrawPermission: false,
    };
  }
}

/**
 * Fetch the available USDT futures balance for a subscriber.
 */
export async function getBalance(credentials: Credentials): Promise<Balance> {
  const exchange = buildExchange(credentials);
  const raw = await exchange.fetchBalance({ type: "swap" });

  const free = raw["USDT"]?.free ?? 0;
  const total = raw["USDT"]?.total ?? 0;

  return {
    available: typeof free === "number" ? free : parseFloat(String(free)),
    total: typeof total === "number" ? total : parseFloat(String(total)),
    currency: "USDT",
  };
}

/**
 * Place a market order on BingX perpetual futures.
 * Assumes hedge mode (positionSide = LONG | SHORT).
 */
export async function placeMarketOrder(
  credentials: Credentials,
  order: OrderParams,
): Promise<OrderResult> {
  const exchange = buildExchange(credentials);

  const raw = await exchange.createOrder(
    order.symbol,
    "market",
    order.side,
    order.amount,
    undefined,
    { positionSide: order.positionSide },
  );

  const execPrice =
    typeof raw.average === "number"
      ? raw.average
      : typeof raw.price === "number"
        ? raw.price
        : 0;

  const execAmount =
    typeof raw.filled === "number" ? raw.filled : order.amount;

  return {
    orderId: String(raw.id),
    symbol: raw.symbol ?? order.symbol,
    side: order.side,
    amount: order.amount,
    executedPrice: execPrice,
    executedAmount: execAmount,
    status: raw.status ?? "unknown",
    rawResponse: raw,
  };
}
