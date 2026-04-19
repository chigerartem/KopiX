/**
 * Root application shell and route table.
 *
 * - Wraps routes in ApiKeysProvider + CopySettingsProvider (copy setup UI state).
 * - Renders the centered "phone" frame (see App.module.css) for a consistent Mini App feel.
 *
 * Future: lazy-load heavy routes, add auth guard routes, or wrap with error boundaries.
 */
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { initTelegramWebApp } from "@/services/telegram";
import { ApiKeysProvider } from "@/contexts/ApiKeysContext";
import { CopySettingsProvider } from "@/contexts/CopySettingsContext";
import { ApiKeysAddPage } from "@/pages/ApiKeysAddPage";
import { ApiKeysPage } from "@/pages/ApiKeysPage";
import { SplashPage } from "@/pages/SplashPage";
import { DashboardScreen } from "@/screens/Dashboard";
import { TradesScreen } from "@/screens/Trades";
import { CopySettingsScreen } from "@/screens/CopySettings";
import { SubscriptionScreen } from "@/screens/Subscription";
import styles from "./App.module.css";

export default function App() {
  useEffect(() => {
    initTelegramWebApp();
  }, []);

  return (
    <div className={styles.viewport}>
      <div className={styles.frame}>
        <ApiKeysProvider>
          <CopySettingsProvider>
            {/*
            Route map — keep in sync with docs/architecture.md
            ApiKeysAddPage handles both /add and /:keyId/edit via useParams
          */}
            <Routes>
              <Route path="/" element={<SplashPage />} />
              <Route path="/dashboard" element={<DashboardScreen />} />
              <Route path="/subscription/setup" element={<SubscriptionScreen />} />
              <Route path="/copy-settings" element={<CopySettingsScreen />} />
              <Route path="/trades" element={<TradesScreen />} />
              <Route path="/api-keys" element={<ApiKeysPage />} />
              <Route path="/api-keys/add" element={<ApiKeysAddPage />} />
              <Route path="/api-keys/:keyId/edit" element={<ApiKeysAddPage />} />
              <Route
                path="/api-keys/connect"
                element={<Navigate to="/api-keys/add" replace />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </CopySettingsProvider>
        </ApiKeysProvider>
      </div>
    </div>
  );
}
