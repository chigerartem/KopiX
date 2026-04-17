/**
 * BingX listen-key management.
 * Obtains, refreshes, and revokes listen keys for the private user data stream.
 *
 * Docs: POST /openApi/user/auth/userDataStream
 *       PUT  /openApi/user/auth/userDataStream  (extend — call every 30 min)
 */

import { createHmac } from "node:crypto";
import { logger } from "../logger.js";

const BINGX_REST = "https://open-api.bingx.com";
const LISTEN_KEY_PATH = "/openApi/user/auth/userDataStream";

function sign(queryString: string, secret: string): string {
  return createHmac("sha256", secret).update(queryString).digest("hex");
}

function buildSignedUrl(path: string, apiKey: string, secret: string): string {
  const ts = Date.now();
  const params = `timestamp=${ts}`;
  const signature = sign(params, secret);
  return `${BINGX_REST}${path}?${params}&signature=${signature}&X-BX-APIKEY=${apiKey}`;
}

export async function createListenKey(apiKey: string, secret: string): Promise<string> {
  const url = buildSignedUrl(LISTEN_KEY_PATH, apiKey, secret);
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`createListenKey HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { listenKey?: string; data?: { listenKey?: string } };
  const key = body.listenKey ?? body.data?.listenKey;
  if (!key) throw new Error("createListenKey: no listenKey in response");
  logger.info({ event: "listen_key.created" }, "Listen key obtained");
  return key;
}

export async function extendListenKey(listenKey: string, apiKey: string, secret: string): Promise<void> {
  const ts = Date.now();
  const params = `listenKey=${listenKey}&timestamp=${ts}`;
  const signature = sign(params, secret);
  const url = `${BINGX_REST}${LISTEN_KEY_PATH}?${params}&signature=${signature}&X-BX-APIKEY=${apiKey}`;
  const res = await fetch(url, { method: "PUT" });
  if (!res.ok) {
    logger.warn({ event: "listen_key.extend_failed", status: res.status }, "Failed to extend listen key");
    return;
  }
  logger.debug({ event: "listen_key.extended" }, "Listen key extended");
}
