import { useCallback, useEffect, useRef } from "react";

type UseActivePageRefreshOptions = {
  refresh: () => Promise<void> | void;
  intervalMs?: number;
  minIntervalMs?: number;
};

/**
 * Runs `refresh` when page mounts, when app tab becomes active again,
 * and optionally on an interval while this page is mounted.
 */
export function useActivePageRefresh({
  refresh,
  intervalMs,
  minIntervalMs = 1200,
}: UseActivePageRefreshOptions): void {
  const inFlightRef = useRef(false);
  const refreshRef = useRef(refresh);
  const lastRunAtRef = useRef(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const runRefresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRunAtRef.current < minIntervalMs) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    lastRunAtRef.current = now;
    try {
      await refreshRef.current();
    } finally {
      inFlightRef.current = false;
    }
  }, [minIntervalMs]);

  useEffect(() => {
    void runRefresh();
  }, [runRefresh]);

  useEffect(() => {
    const onFocus = () => {
      void runRefresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void runRefresh();
      }
    };
    const onPageShow = () => {
      void runRefresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);

    let intervalId: number | null = null;
    if (intervalMs && intervalMs > 0) {
      intervalId = window.setInterval(() => {
        void runRefresh();
      }, intervalMs);
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [intervalMs, runRefresh]);
}

