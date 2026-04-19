/**
 * Main home screen: header, balance, subscription card, trades carousel, bottom tabs.
 * Side menu navigates to API Keys; other actions use placeholder toasts until APIs exist.
 */
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "@/contexts/AppStateContext";
import { useActivePageRefresh } from "@/hooks/useActivePageRefresh";
import { BalanceCard, type BalanceCardStats } from "@/components/dashboard/BalanceCard";
import { BottomTabBar, type TabId } from "@/components/dashboard/BottomTabBar";
import { SubscriptionCard } from "@/components/dashboard/SubscriptionCard";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardSideMenu } from "@/components/dashboard/DashboardSideMenu";
import { OpenTradesSection } from "@/components/dashboard/OpenTradesSection";
import {
  getBalance,
  getSwapPnlHistory,
  getSwapPositions,
} from "@/services/api";
import type { OpenTradePosition } from "@/types/trade";
import styles from "./DashboardPage.module.css";

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    setSubscriptionStatus,
    setSubscriptionValidUntil,
    dashboardBalanceStats,
    dashboardOpenTrades,
    setDashboardBalanceStats,
    setDashboardOpenTrades,
    setTradesOpen,
    refreshSubscriptionStatus,
  } = useAppState();
  const [tab, setTab] = useState<TabId>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 2400);
  }, []);

  const refreshDashboardData = useCallback(async () => {
    const [balance, pnlHistory, positions, subStatus] = await Promise.all([
      getBalance(),
      getSwapPnlHistory(),
      getSwapPositions(),
      refreshSubscriptionStatus(),
    ]);

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const todayPnl = pnlHistory
      .filter((p) => p.asset === "USDT" && now - p.timeMs <= oneDayMs)
      .reduce((sum, p) => sum + p.income, 0);
    const pnlTodayPct = balance > 0 ? (todayPnl / balance) * 100 : 0;

    setDashboardBalanceStats({
      totalBalanceUsdt: balance,
      pnlTodayUsdt: todayPnl,
      pnlTodayPct,
    });
    setDashboardOpenTrades(positions);
    setTradesOpen(positions);
    setSubscriptionStatus(subStatus.state);
    setSubscriptionValidUntil(subStatus.activeTo);
  }, [
    setDashboardBalanceStats,
    setDashboardOpenTrades,
    setTradesOpen,
    setSubscriptionStatus,
    setSubscriptionValidUntil,
    refreshSubscriptionStatus,
  ]);

  useActivePageRefresh({
    refresh: async () => {
      try {
        await refreshDashboardData();
      } catch (err) {
        console.error("[Dashboard] dashboard data load failed", err);
      }
    },
    intervalMs: 8000,
  });

  const handlePayPending = useCallback(() => {
    void refreshSubscriptionStatus({ force: true })
      .then((status) => {
        setSubscriptionStatus(status.state);
        setSubscriptionValidUntil(status.activeTo);
        if (status.state === "active") {
          notify("Subscription is active");
          return;
        }
        if (status.payUrl) {
          window.location.href = status.payUrl;
          return;
        }
        notify("Payment link is unavailable");
      })
      .catch((err) => {
        console.error("[Dashboard] payment status sync failed", err);
        notify("Unable to check payment status");
      });
  }, [notify, refreshSubscriptionStatus, setSubscriptionStatus, setSubscriptionValidUntil]);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <DashboardHeader onMenuClick={() => setMenuOpen(true)} />

        <div className={styles.stack}>
          <BalanceCard stats={dashboardBalanceStats as Partial<BalanceCardStats>} />

          <SubscriptionCard onPay={handlePayPending} />

          <OpenTradesSection
            trades={dashboardOpenTrades as OpenTradePosition[]}
            onManageClick={() => {
              setTab("trades");
              navigate("/trades");
            }}
          />
        </div>
      </div>

      <DashboardSideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onApiKeysClick={() => navigate("/api-keys")}
        onCopySettingsClick={() => navigate("/copy-settings")}
      />

      {toast ? (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      ) : null}

      <BottomTabBar
        active={tab}
        onChange={(id) => {
          setTab(id);
          if (id === "trades") {
            setTab("trades");
            navigate("/trades");
            return;
          }
        }}
      />
    </div>
  );
}
