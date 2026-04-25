/**
 * SubscriberContext — single source of truth for subscriber state used by
 * the interactive flows (API keys, copy settings, subscription).
 *
 * Wraps `GET /api/subscribers/me`. Pages call `refresh()` after any mutation
 * (validate key, save settings, pause/resume, payment confirmation) so the
 * UI stays consistent without a route reload.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSubscriberMe, type SubscriberMe } from "@/services/api";

/**
 * Onboarding step derived from `me`.
 *
 * The product imposes a strict order: subscribe → connect BingX → set copy
 * mode → done. Pages use `step` to gate access (show prerequisite notices
 * instead of forms) and the dashboard uses it to render a guided
 * "Step N/3" card until the flow is complete.
 */
export type OnboardingStep =
  | "subscribe"
  | "api_key"
  | "copy_settings"
  | "done";

export const ONBOARDING_TOTAL = 3;

export function stepIndex(step: OnboardingStep): number {
  switch (step) {
    case "subscribe":
      return 1;
    case "api_key":
      return 2;
    case "copy_settings":
      return 3;
    case "done":
      return 3;
  }
}

function deriveStep(me: SubscriberMe | null): OnboardingStep {
  if (!me) return "subscribe";
  if (!me.subscription || me.subscription.status !== "active") return "subscribe";
  if (!me.hasExchangeConnected) return "api_key";
  const fixedSet = me.copyMode === "fixed" && (me.fixedAmount ?? 0) > 0;
  const pctSet = me.copyMode === "percentage" && (me.percentage ?? 0) > 0;
  if (!fixedSet && !pctSet) return "copy_settings";
  return "done";
}

type SubscriberContextValue = {
  me: SubscriberMe | null;
  loading: boolean;
  error: string | null;
  step: OnboardingStep;
  refresh: () => Promise<void>;
};

const SubscriberContext = createContext<SubscriberContextValue | null>(null);

export function SubscriberProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<SubscriberMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const p = (async () => {
      setLoading(true);
      try {
        const data = await getSubscriberMe();
        setMe(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    return p;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ me, loading, error, step: deriveStep(me), refresh }),
    [me, loading, error, refresh],
  );

  return (
    <SubscriberContext.Provider value={value}>
      {children}
    </SubscriberContext.Provider>
  );
}

export function useSubscriber(): SubscriberContextValue {
  const ctx = useContext(SubscriberContext);
  if (!ctx) {
    throw new Error("useSubscriber must be used within SubscriberProvider");
  }
  return ctx;
}
