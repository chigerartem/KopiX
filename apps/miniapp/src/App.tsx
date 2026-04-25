/**
 * Root application shell and route table.
 *
 * Miniapp owns the full interactive surface:
 *   /                    → splash → /dashboard
 *   /dashboard           → balance, subscription status, open trades
 *   /trades              → full trades list
 *   /api-keys            → connected BingX key (or empty state)
 *   /api-keys/add        → paste + validate BingX key
 *   /copy-settings       → copy mode + sizing + pause/resume
 *   /subscription/setup  → pick plan + pay via CryptoBot
 *
 * The bot is read-only — it shows app description and pushes trade notifications.
 */
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { initTelegramWebApp } from "@/services/telegram";
import { SubscriberProvider } from "@/contexts/SubscriberContext";
import { SplashPage } from "@/pages/SplashPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { TradesPage } from "@/pages/TradesPage";
import { ApiKeysPage } from "@/pages/ApiKeysPage";
import { ApiKeysAddPage } from "@/pages/ApiKeysAddPage";
import { CopySettingsPage } from "@/pages/CopySettingsPage";
import { SubscriptionSetupPage } from "@/pages/SubscriptionSetupPage";
import styles from "./App.module.css";

export default function App() {
  useEffect(() => {
    initTelegramWebApp();
  }, []);

  return (
    <SubscriberProvider>
      <div className={styles.viewport}>
        <div className={styles.frame}>
          <Routes>
            <Route path="/" element={<SplashPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/trades" element={<TradesPage />} />
            <Route path="/api-keys" element={<ApiKeysPage />} />
            <Route path="/api-keys/add" element={<ApiKeysAddPage />} />
            <Route path="/copy-settings" element={<CopySettingsPage />} />
            <Route path="/subscription/setup" element={<SubscriptionSetupPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </SubscriberProvider>
  );
}
