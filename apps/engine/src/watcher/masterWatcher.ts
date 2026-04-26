/**
 * Master Account Watcher.
 *
 * Flow:
 *  1. Obtain listenKey via REST
 *  2. Open WebSocket: wss://open-api-ws.bingx.com/market?listenKey={key}
 *  3. Refresh listenKey every 30 min via PUT
 *  4. WS-level ping every 20s + stale-data watchdog (60s) — so we detect
 *     half-dead connections (proxy ate our packets) and force reconnect.
 *  5. On disconnect: reconnect with exponential backoff (1s → 5s → 30s → 5min)
 *  6. On reconnect: log the data gap so ops can spot missed-event windows.
 *  7. On ORDER_TRADE_UPDATE events: call the provided onEvent callback
 */

import WebSocket from "ws";
import { createListenKey, extendListenKey } from "./listenKey.js";
import { logger } from "../logger.js";
import { masterWatcherConnected, masterWatcherLastEventTs } from "../metrics.js";

const WS_BASE = "wss://open-api-ws.bingx.com/market";
const EXTEND_INTERVAL_MS = 30 * 60 * 1000; // 30 min listenKey extension
const PING_INTERVAL_MS = 20_000;            // WS-level ping cadence
const STALE_TIMEOUT_MS = 60_000;            // no data for 60s → force reconnect
const GAP_WARN_MS = 30_000;                 // alert if reconnect leaves a gap > 30s
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
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let staleTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffIndex = 0;
  let lastDataAtMs = 0;

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
      const gapMs = lastDataAtMs > 0 ? Date.now() - lastDataAtMs : 0;
      if (gapMs > GAP_WARN_MS) {
        // Master events that fired during this gap will not be replayed via
        // WebSocket. Operator should investigate and may need to manually
        // reconcile via REST history.
        logger.warn(
          { event: "watcher.data_gap", gapMs },
          `Reconnected after ${gapMs}ms of silence — events in that window may have been missed`,
        );
      }
      lastDataAtMs = Date.now();
      logger.info({ event: "watcher.connected" }, "Master WebSocket connected");
      masterWatcherConnected.set(1);
      backoffIndex = 0;

      heartbeatTimer = setInterval(() => {
        extendListenKey(listenKey, apiKey, secret).catch((err: unknown) => {
          logger.warn({ event: "watcher.heartbeat_error", err }, "Heartbeat failed");
        });
      }, EXTEND_INTERVAL_MS);

      // WS-level ping: BingX (and intermediaries) close idle connections
      // without notice. Sending a ping every 20s keeps the path alive.
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch (err: unknown) {
            logger.warn({ event: "watcher.ping_failed", err }, "WS ping threw");
          }
        }
      }, PING_INTERVAL_MS);

      // Stale-data watchdog: if no message for STALE_TIMEOUT_MS, the path
      // is half-dead — terminate so the close handler reconnects.
      staleTimer = setInterval(() => {
        const since = Date.now() - lastDataAtMs;
        if (since > STALE_TIMEOUT_MS && ws && ws.readyState === WebSocket.OPEN) {
          logger.warn(
            { event: "watcher.stale_terminate", sinceMs: since },
            `No WS data for ${since}ms — terminating to force reconnect`,
          );
          ws.terminate(); // hard close; triggers "close" handler → scheduleReconnect
        }
      }, 10_000);
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      lastDataAtMs = Date.now();
      masterWatcherLastEventTs.set(Date.now() / 1000);
      try {
        const text = raw.toString();
        const data = JSON.parse(text) as BingXRawEvent;
        onEvent(data);
      } catch (err) {
        logger.warn({ event: "watcher.parse_error", err }, "Failed to parse WS message");
      }
    });

    // Pong is also a liveness signal; refresh lastDataAtMs so the watchdog
    // doesn't false-positive on quiet trading windows.
    ws.on("pong", () => {
      lastDataAtMs = Date.now();
    });

    ws.on("error", (err: Error) => {
      logger.error({ event: "watcher.ws_error", err }, "WebSocket error");
    });

    ws.on("close", (code: number, reason: Buffer) => {
      clearTimers();
      masterWatcherConnected.set(0);
      if (stopped) return;
      logger.warn(
        { event: "watcher.disconnected", code, reason: reason.toString() },
        "Master WebSocket disconnected — will reconnect",
      );
      scheduleReconnect();
    });
  }

  function clearTimers(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (staleTimer) {
      clearInterval(staleTimer);
      staleTimer = null;
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
      clearTimers();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      logger.info({ event: "watcher.stopped" }, "Master watcher stopped");
    },
  };
}
