import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
  miniAppInvoiceUrl: string;
  botInvoiceUrl: string;
}

export async function createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
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
      mini_app_invoice_url: string;
      bot_invoice_url: string;
    };
    error?: { name: string; code: number };
  };

  const data = (await res.json()) as ApiResponse;

  if (!data.ok || !data.result) {
    throw new Error(`CryptoBot returned error: ${JSON.stringify(data.error)}`);
  }

  return {
    invoiceId: data.result.invoice_id,
    miniAppInvoiceUrl: data.result.mini_app_invoice_url,
    botInvoiceUrl: data.result.bot_invoice_url,
  };
}

// CryptoBot webhook signature: HMAC-SHA-256(body, SHA256(token))
// The body passed here must be the raw JSON string as received from CryptoBot.
export function verifyWebhookSignature(body: string, signature: string): boolean {
  const token = process.env["CRYPTOBOT_API_TOKEN"];
  if (!token) return false;

  try {
    const secret = createHash("sha256").update(token).digest();
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
