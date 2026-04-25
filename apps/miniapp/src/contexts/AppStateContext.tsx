import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SubscriptionStatus } from "@/types/app";
import type { OpenTradePosition } from "@/types/trade";
import { getSubscriberMe } from "@/services/api";

type DashboardBalanceStats = {
  totalBalanceUsdt: number;
  pnlTodayUsdt: number;
  pnlTodayPct: number;
};

type AppStateContextValue = {
  subscriptionStatus: SubscriptionStatus;
  subscriptionValidUntil: string | null;
  isSubscriptionSyncing: boolean;
  dashboardBalanceStats: Partial<DashboardBalanceStats>;
  dashboardOpenTrades: OpenTradePosition[];
  tradesOpen: OpenTradePosition[];
  tradesClosed: OpenTradePosition[];
  setSubscriptionStatus: (status: SubscriptionStatus) => void;
  setSubscriptionValidUntil: (iso: string | null) => void;
  setDashboardBalanceStats: (stats: Partial<DashboardBalanceStats>) => void;
  setDashboardOpenTrades: (trades: OpenTradePosition[]) => void;
  setTradesOpen: (trades: OpenTradePosition[]) => void;
  setTradesClosed: (trades: OpenTradePosition[]) => void;
  refreshSubscriptionStatus: (opts?: { force?: boolean }) => Promise<{
    state: SubscriptionStatus;
    payUrl: string | null;
    activeTo: string | null;
  }>;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatus>("inactive");
  const [subscriptionValidUntil, setSubscriptionValidUntil] = useState<
    string | null
  >(null);
  const [isSubscriptionSyncing, setIsSubscriptionSyncing] = useState(false);
  const [dashboardBalanceStats, setDashboardBalanceStats] = useState<
    Partial<DashboardBalanceStats>
  >({});
  const [dashboardOpenTrades, setDashboardOpenTrades] = useState<
    OpenTradePosition[]
  >([]);
  const [tradesOpen, setTradesOpen] = useState<OpenTradePosition[]>([]);
  const [tradesClosed, setTradesClosed] = useState<OpenTradePosition[]>([]);
  const lastSubscriptionSyncAtRef = useRef(0);
  const inFlightSubscriptionSyncRef = useRef<
    Promise<{
      state: SubscriptionStatus;
      payUrl: string | null;
      activeTo: string | null;
    }> | null
  >(null);

  const refreshSubscriptionStatus = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const now = Date.now();
      if (!force && now - lastSubscriptionSyncAtRef.current < 1200) {
        return {
          state: subscriptionStatus,
          payUrl: null,
          activeTo: subscriptionValidUntil,
        };
      }
      if (inFlightSubscriptionSyncRef.current) {
        return inFlightSubscriptionSyncRef.current;
      }

      const promise = (async () => {
        setIsSubscriptionSyncing(true);
        try {
          const me = await getSubscriberMe();
          const state: SubscriptionStatus =
            me.subscription && me.subscription.status === "active"
              ? "active"
              : "inactive";
          const activeTo = me.subscription?.expiresAt ?? null;
          setSubscriptionStatus(state);
          setSubscriptionValidUntil(activeTo);
          lastSubscriptionSyncAtRef.current = Date.now();
          return { state, payUrl: null, activeTo };
        } finally {
          setIsSubscriptionSyncing(false);
          inFlightSubscriptionSyncRef.current = null;
        }
      })();
      inFlightSubscriptionSyncRef.current = promise;
      return promise;
    },
    [subscriptionStatus, subscriptionValidUntil],
  );

  const value = useMemo(
    () => ({
      subscriptionStatus,
      subscriptionValidUntil,
      isSubscriptionSyncing,
      dashboardBalanceStats,
      dashboardOpenTrades,
      tradesOpen,
      tradesClosed,
      setSubscriptionStatus,
      setSubscriptionValidUntil,
      setDashboardBalanceStats,
      setDashboardOpenTrades,
      setTradesOpen,
      setTradesClosed,
      refreshSubscriptionStatus,
    }),
    [
      subscriptionStatus,
      subscriptionValidUntil,
      isSubscriptionSyncing,
      dashboardBalanceStats,
      dashboardOpenTrades,
      tradesOpen,
      tradesClosed,
      refreshSubscriptionStatus,
    ],
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return ctx;
}
