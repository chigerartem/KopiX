import { useEffect, useRef } from "react";
import { useTma } from "./useTma";

interface SseEvent {
  type: string;
  data: Record<string, unknown>;
}

export function useSse(onEvent: (event: SseEvent) => void): void {
  const { initData } = useTma();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        const res = await fetch("/api/stream/trades", {
          headers: { Authorization: `TMA ${initData}` },
        });

        if (!res.ok || !res.body) {
          scheduleRetry();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const dataLine = chunk
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            try {
              const parsed: unknown = JSON.parse(dataLine.slice(5).trim());
              if (
                parsed !== null &&
                typeof parsed === "object" &&
                "type" in parsed &&
                "data" in parsed
              ) {
                onEventRef.current(parsed as SseEvent);
              }
            } catch {
              // malformed chunk — skip
            }
          }
        }
      } catch {
        // network error
      }

      if (active) {
        scheduleRetry();
      }
    }

    function scheduleRetry() {
      retryTimer = setTimeout(() => {
        if (active) connect();
      }, 5000);
    }

    connect();

    return () => {
      active = false;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [initData]);
}
