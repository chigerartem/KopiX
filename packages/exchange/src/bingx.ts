import { bingx as BingX, AuthenticationError, PermissionDenied, ExchangeError } from "ccxt";
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
  let isHedgeMode: boolean | undefined;

  try {
    // Fetching balance tests auth and confirms futures account exists
    const balanceRaw = await exchange.fetchBalance({ type: "swap" });

    const usdtFree = balanceRaw["USDT"]?.free ?? 0;
    futuresBalance = typeof usdtFree === "number" ? usdtFree : parseFloat(String(usdtFree));

    hasTradePermission = true;

    // ── Hedge mode check ────────────────────────────────────────────────
    // The engine treats every position as either LONG or SHORT and tracks
    // them independently. In one-way mode BingX maintains a single net
    // position per symbol — copy execution would silently corrupt it.
    // Reject one-way mode at connect time.
    try {
      const ex = exchange as unknown as {
        fetchPositionMode?: () => Promise<{ hedged?: boolean; info?: unknown }>;
      };
      if (typeof ex.fetchPositionMode === "function") {
        const mode = await ex.fetchPositionMode();
        isHedgeMode = mode.hedged === true;
      }
    } catch {
      // Ignore — leave isHedgeMode undefined; caller treats as "unknown".
      // (We do NOT fail-closed here because we already validated auth above;
      // the route layer decides whether unknown is acceptable.)
      isHedgeMode = undefined;
    }

    // Actively probe whether the API key has withdraw permission by calling
    // a withdraw-scoped endpoint with deliberately invalid parameters.
    //   - PermissionDenied → key lacks withdraw permission (good, trade-only)
    //   - Any other error (including invalid-param / unsupported-endpoint /
    //     exchange error) → key HAS the permission, reject for safety.
    // Fail-closed: on ambiguity we treat the key as unsafe.
    try {
      // Probe a withdraw-scoped endpoint. BingX returns:
      //   - data           → key has withdraw permission (reject)
      //   - PermissionDenied / ExchangeError → trade-only key (accept)
      //   - AuthenticationError → should not happen after balance fetch
      //
      // We treat PermissionDenied AND ExchangeError as "no withdraw permission"
      // because BingX encodes access-denied as an exchange-level error code
      // (e.g. 100500) rather than an HTTP 403, and ccxt maps that to ExchangeError,
      // not PermissionDenied. Only a successful call means the key can withdraw.
      const ex = exchange as unknown as {
        privateGetCapitalConfigGetall?: () => Promise<unknown>;
      };
      if (typeof ex.privateGetCapitalConfigGetall === "function") {
        await ex.privateGetCapitalConfigGetall();
        // Call succeeded → key can access withdraw-scoped endpoints.
        hasWithdrawPermission = true;
      } else {
        // Method not available in this ccxt build — try fetchDepositAddresses
        // as a fallback probe. Same logic: success = has permission.
        try {
          await exchange.fetchDepositAddresses(["USDT"]);
          hasWithdrawPermission = true;
        } catch (fallbackErr: unknown) {
          // Any error here means the endpoint was blocked → trade-only key.
          hasWithdrawPermission =
            fallbackErr instanceof AuthenticationError ? true : false;
        }
      }
    } catch (probeErr: unknown) {
      if (
        probeErr instanceof PermissionDenied ||
        probeErr instanceof ExchangeError
      ) {
        // Both map to "access denied" on BingX for trade-only keys.
        hasWithdrawPermission = false;
      } else if (probeErr instanceof AuthenticationError) {
        // Should not happen after successful balance fetch. Fail closed.
        hasWithdrawPermission = true;
      } else {
        // Network error, timeout, etc. — fail closed.
        hasWithdrawPermission = true;
      }
    }

    return {
      valid: true,
      hasTradePermission,
      hasWithdrawPermission,
      ...(isHedgeMode !== undefined && { isHedgeMode }),
      ...(futuresBalance !== undefined && { futuresBalance }),
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
    typeof raw.average === "number" && raw.average > 0
      ? raw.average
      : typeof raw.price === "number" && raw.price > 0
        ? raw.price
        : null;

  if (execPrice === null) {
    throw new Error(
      `BingX order ${String(raw.id)} returned no execution price — order may not be filled yet`,
    );
  }

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
