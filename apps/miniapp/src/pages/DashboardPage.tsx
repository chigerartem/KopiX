/**
 * Main home screen.
 *
 * Until the subscriber finishes onboarding (subscribe → connect BingX → set
 * copy mode), the dashboard hides balance/positions and shows a single
 * guided "Step N of 3" card with a CTA pointing at the next required
 * screen. Once `step === "done"`, the regular widgets render and we start
 * polling exchange data.
 */
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "@/contexts/AppStateContext";
import { useSubscriber } from "@/contexts/SubscriberContext";
import { useActivePageRefresh } from "@/hooks/useActivePageRefresh";
import { BalanceCard, type BalanceCardStats } from "@/components/dashboard/BalanceCard";
import { BottomTabBar, type TabId } from "@/components/dashboard/BottomTabBar";
import { SubscriptionCard } from "@/components/dashboard/SubscriptionCard";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardSideMenu } from "@/components/dashboard/DashboardSideMenu";
import { OnboardingCard } from "@/components/dashboard/OnboardingCard";
import { OpenTradesSection } from "@/components/dashboard/OpenTradesSection";
import { PausedBanner } from "@/components/dashboard/PausedBanner";
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
  const { me, step, refresh: refreshSubscriber } = useSubscriber();
  const [tab, setTab] = useState<TabId>("home");
  const [menuOpen, setMenuOpen] = useState(false);

  const onboardingComplete = step === "done";

  const refreshDashboardData = useCallback(async () => {
    // Always pick up the latest subscriber profile so `step` advances after
    // the user returns from a CryptoBot payment / API key add.
    await refreshSubscriber();

    // Skip exchange-data calls until the user has actually connected a key
    // and finished setup — otherwise we'd hammer endpoints that just return 0.
    if (step !== "done") {
      const subStatus = await refreshSubscriptionStatus();
      setSubscriptionStatus(subStatus.state);
      setSubscriptionValidUntil(subStatus.activeTo);
      return;
    }

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
    step,
    refreshSubscriber,
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
          {onboardingComplete ? (
            <>
              {me?.status === "paused" && <PausedBanner />}
              <BalanceCard stats={dashboardBalanceStats as Partial<BalanceCardStats>} />
              <SubscriptionCard />
              <OpenTradesSection
                trades={dashboardOpenTrades as OpenTradePosition[]}
                onManageClick={() => {
                  setTab("trades");
                  navigate("/trades");
                }}
              />
            </>
          ) : (
            <OnboardingCard step={step} />
          )}
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
