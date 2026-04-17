/**
 * Master Account Watcher.
 *
 * Flow:
 *  1. Obtain listenKey via REST
 *  2. Open WebSocket: wss://open-api-ws.bingx.com/market?listenKey={key}
 *  3. Refresh listenKey every 30 min via PUT
 *  4. On disconnect: reconnect with exponential backoff (1s → 5s → 30s → 5min)
 *  5. On ORDER_TRADE_UPDATE events: call the provided onEvent callback
 */

import WebSocket from "ws";
import { createListenKey, extendListenKey } from "./listenKey.js";
import { logger } from "../logger.js";

const WS_BASE = "wss://open-api-ws.bingx.com/market";
const EXTEND_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const BACKOFF_STEPS_MS = [1_000, 5_000, 30_000, 5 * 60_000];

export type BingXRawEvent = Record<string, unknown>;
export type EventHandler = (event: BingXRawEvent) => void;

export interface WatcherHandle {
  stop: () => void;
}

export function startMasterWatcher(
  apiKey: string,
  secret: string,
  onEvent: EventHandler,
): WatcherHandle {
  let stopped = false;
  let ws: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffIndex = 0;

  async function connect(): Promise<void> {
    if (stopped) return;

    let listenKey: string;
    try {
      listenKey = await createListenKey(apiKey, secret);
    } catch (err) {
      logger.error({ event: "watcher.listen_key_failed", err }, "Cannot obtain listenKey");
      scheduleReconnect();
      return;
    }

    const url = `${WS_BASE}?listenKey=${listenKey}`;
    ws = new WebSocket(url);

    ws.on("open", () => {
      logger.info({ event: "watcher.connected" }, "Master WebSocket connected");
      backoffIndex = 0; // reset on successful connect

      heartbeatTimer = setInterval(() => {
        extendListenKey(listenKey, apiKey, secret).catch((err: unknown) => {
          logger.warn({ event: "watcher.heartbeat_error", err }, "Heartbeat failed");
        });
      }, EXTEND_INTERVAL_MS);
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const text = raw.toString();
        const data = JSON.parse(text) as BingXRawEvent;
        onEvent(data);
      } catch (err) {
        logger.warn({ event: "watcher.parse_error", err }, "Failed to parse WS message");
      }
    });

    ws.on("error", (err: Error) => {
      logger.error({ event: "watcher.ws_error", err }, "WebSocket error");
    });

    ws.on("close", (code: number, reason: Buffer) => {
      clearHeartbeat();
      if (stopped) return;
      logger.warn(
        { event: "watcher.disconnected", code, reason: reason.toString() },
        "Master WebSocket disconnected — will reconnect",
      );
      scheduleReconnect();
    });
  }

  function clearHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleReconnect(): void {
    const delayMs = BACKOFF_STEPS_MS[Math.min(backoffIndex, BACKOFF_STEPS_MS.length - 1)] ?? 5_000;
    backoffIndex++;
    logger.info({ event: "watcher.reconnect_scheduled", delayMs }, `Reconnecting in ${delayMs}ms`);
    reconnectTimer = setTimeout(() => {
      connect().catch((err: unknown) => {
        logger.error({ event: "watcher.reconnect_failed", err });
        scheduleReconnect();
      });
    }, delayMs);
  }

  connect().catch((err: unknown) => {
    logger.error({ event: "watcher.initial_connect_failed", err });
    scheduleReconnect();
  });

  return {
    stop() {
      stopped = true;
      clearHeartbeat();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      logger.info({ event: "watcher.stopped" }, "Master watcher stopped");
    },
  };
}
