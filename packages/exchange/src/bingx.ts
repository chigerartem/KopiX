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

    hasTradePermission = true;

    // Actively probe whether the API key has withdraw permission by calling
    // a withdraw-scoped endpoint with deliberately invalid parameters.
    //   - PermissionDenied → key lacks withdraw permission (good, trade-only)
    //   - Any other error (including invalid-param / unsupported-endpoint /
    //     exchange error) → key HAS the permission, reject for safety.
    // Fail-closed: on ambiguity we treat the key as unsafe.
    try {
      // privateGetCapitalConfigGetall is a withdraw/capital-movement endpoint.
      // A trade-only key returns PermissionDenied; a withdraw-capable key
      // returns data. If the method itself is unavailable in ccxt, we fall
      // back to assuming the permission is present (fail-closed).
      const ex = exchange as unknown as {
        privateGetCapitalConfigGetall?: () => Promise<unknown>;
      };
      if (typeof ex.privateGetCapitalConfigGetall === "function") {
        await ex.privateGetCapitalConfigGetall();
        // Call succeeded → key can access withdraw-scoped endpoints.
        hasWithdrawPermission = true;
      } else {
        // Endpoint unknown to this ccxt version — fail closed.
        hasWithdrawPermission = true;
      }
    } catch (probeErr: unknown) {
      if (probeErr instanceof PermissionDenied) {
        hasWithdrawPermission = false;
      } else if (probeErr instanceof AuthenticationError) {
        // Should not happen — balance fetch already succeeded. Fail closed.
        hasWithdrawPermission = true;
      } else {
        // Any other error (including bad-param) — fail closed: assume
        // permission may be present. Operator must use a trade-only key.
        hasWithdrawPermission = true;
      }
    }

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
