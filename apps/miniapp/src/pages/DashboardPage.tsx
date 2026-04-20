/**
 * Main home screen: header, balance, subscription status, trades carousel, bottom tabs.
 *
 * Read-only dashboard — API key connection, copy settings, and subscription
 * purchase are all managed in the Telegram bot (/connect, /mode, /subscribe).
 */
import { useCallback, useState } from "react";
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

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <DashboardHeader onMenuClick={() => setMenuOpen(true)} />

        <div className={styles.stack}>
          <BalanceCard stats={dashboardBalanceStats as Partial<BalanceCardStats>} />

          <SubscriptionCard />

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
      />

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
