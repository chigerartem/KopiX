/**
 * Minimal CryptoBot Pay API client for the bot app.
 * Mirrors apps/api/src/lib/cryptobot.ts — invoice creation only.
 * Signature verification lives in the API (webhook handler).
 */

const API_BASE = "https://pay.crypt.bot/api";

export interface CreateInvoiceParams {
  asset: string;
  amount: string;
  description: string;
  payload: string;
  paidBtnUrl: string;
}

export interface InvoiceResult {
  invoiceId: number;
  botInvoiceUrl: string;
  miniAppInvoiceUrl: string;
}

export async function createInvoice(
  params: CreateInvoiceParams,
): Promise<InvoiceResult> {
  const token = process.env["CRYPTOBOT_API_TOKEN"];
  if (!token) throw new Error("CRYPTOBOT_API_TOKEN is not set");

  const res = await fetch(`${API_BASE}/createInvoice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Crypto-Pay-API-Token": token,
    },
    body: JSON.stringify({
      asset: params.asset,
      amount: params.amount,
      description: params.description,
      payload: params.payload,
      paid_btn_name: "callback",
      paid_btn_url: params.paidBtnUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CryptoBot API ${res.status}: ${body}`);
  }

  type ApiResponse = {
    ok: boolean;
    result?: {
      invoice_id: number;
      bot_invoice_url: string;
      mini_app_invoice_url: string;
    };
    error?: { name: string; code: number };
  };

  const data = (await res.json()) as ApiResponse;

  if (!data.ok || !data.result) {
    throw new Error(`CryptoBot error: ${JSON.stringify(data.error)}`);
  }

  return {
    invoiceId: data.result.invoice_id,
    botInvoiceUrl: data.result.bot_invoice_url,
    miniAppInvoiceUrl: data.result.mini_app_invoice_url,
  };
}
